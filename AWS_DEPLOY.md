# VibeMeter — AWS Deployment Guide (Phase 1 / Free Tier)

This guide covers deploying VibeMeter to AWS using free-tier eligible services.
Estimated cost: ~$0–5/month for the first 12 months.

---

## Architecture Overview

```
Mobile App (Expo / iOS)
      │  HTTPS
      ▼
YOUR_IP.nip.io → Elastic IP → EC2 t3.micro
                                  ├── Nginx (TLS termination, ports 80 + 443)
                                  ├── Go API (Docker, port 8080)
                                  ├── Redis 7 (Docker, port 6379)
                                  └── YAMNet ML (Docker, port 8082)
                                        │
                                RDS db.t3.micro
                                (PostgreSQL 16 + PostGIS)

nip.io — free wildcard DNS: YOUR_IP.nip.io → YOUR_IP (no signup needed)
Let's Encrypt — free SSL cert for the nip.io hostname (auto-renews)
OpenStreetMap Overpass API — free venue data fetched on demand per location
SQS (async jobs — leaderboards, push fan-out, spam detection)
```

---

## Step 1 — Create AWS Account

1. Go to `aws.amazon.com` → **Create an AWS Account**
2. Enter email, choose account name (e.g. `vibemeter`)
3. Select **Personal** account type
4. Enter credit card (required, but free tier = $0 charged)
5. Phone verification → choose **Basic support (free)**

### Immediately after signup

**Enable MFA on root account:**
`Top-right → your account name → Security credentials → MFA → Assign MFA device`
Use any authenticator app. The root account has unlimited power — protect it.

**Set a billing alert:**
`Services → Billing → Budgets → Create budget`
- Budget type: Cost budget
- Amount: `$10`
- Alert at: 80% actual → your email

**Pick your region:**
Set to **eu-north-1 (Stockholm)** in the top-right region dropdown.
All subsequent steps must be done in this region.

---

## Step 2 — Create IAM User

Never use root for day-to-day work.

`Services → IAM → Users → Create user`
- Username: `vibemeter-admin`
- Check: **Provide user access to AWS Management Console**
- Attach policies: `AdministratorAccess`
- Download the credentials CSV

Sign out of root. Sign in as `vibemeter-admin` from now on.

---

## Step 3 — Create Security Groups

`Services → EC2 → Security Groups → Create security group`

### EC2 Security Group
- Name: `vibemeter-ec2-sg`
- VPC: default VPC
- Inbound rules:

| Type | Port | Source | Why |
|---|---|---|---|
| HTTP | 80 | 0.0.0.0/0 | Mobile app traffic |
| HTTPS | 443 | 0.0.0.0/0 | Future SSL |

> No SSH rule needed — we use SSM Session Manager to connect (see Step 5).

### RDS Security Group
- Name: `vibemeter-rds-sg`
- VPC: default VPC
- Inbound rules:

| Type | Port | Source | Why |
|---|---|---|---|
| PostgreSQL | 5432 | `vibemeter-ec2-sg` (select the SG ID) | Only EC2 can reach Postgres |

---

## Step 4 — Launch EC2 t3.micro

`Services → EC2 → Instances → Launch instances`

- **Name:** `vibemeter-api`
- **AMI:** Amazon Linux 2023 (free tier eligible, 64-bit x86)
- **Instance type:** t3.micro (confirm "Free tier eligible" label)
- **Key pair:** Proceed without key pair (we use SSM, not SSH)
- **Network settings:**
  - VPC: default
  - Subnet: any (e.g. `eu-north-1a`)
  - Auto-assign public IP: **Enable**
  - Security group: `vibemeter-ec2-sg`
- **Storage:** 30 GB gp2 (free tier limit — do not exceed)

Click **Launch instance**.

### Allocate Elastic IP
`EC2 → Elastic IPs → Allocate Elastic IP address → Allocate`

Then: `Actions → Associate Elastic IP`
- Resource type: Instance
- Instance: `vibemeter-api`

Note this IP — this is your permanent server address.

---

## Step 5 — Set Up SSM Session Manager (replaces SSH)

SSM lets you connect to EC2 from any network without port 22 or a key file.
This avoids the "Operation timed out" SSH errors caused by changing home IPs.

### Attach IAM Role to EC2

`IAM → Roles → Create role`
- Trusted entity: AWS service → EC2
- Attach policies: `AmazonSSMManagedInstanceCore` + `AmazonSQSFullAccess`
- Role name: `vibemeter-ec2-role`

`EC2 → Instances → vibemeter-api → Actions → Security → Modify IAM role → vibemeter-ec2-role → Update`

### Verify SSM Agent is running

Connect once via **EC2 Instance Connect** (browser-based):
`EC2 → Instances → select instance → Connect → EC2 Instance Connect → Connect`

Inside the browser terminal:
```bash
sudo systemctl enable amazon-ssm-agent
sudo systemctl start amazon-ssm-agent
sudo systemctl status amazon-ssm-agent
```

### Install AWS CLI + Session Manager plugin on your Mac

```bash
brew install awscli
brew install --cask session-manager-plugin
```

### Create Access Key for CLI

`IAM → Users → vibemeter-admin → Security credentials → Create access key`
- Use case: Command Line Interface (CLI)
- Description tag: `macbook-cli`
- Download the CSV immediately (secret shown only once)

```bash
aws configure
# AWS Access Key ID:     → paste key ID
# AWS Secret Access Key: → paste secret
# Default region name:   → eu-north-1
# Default output format: → json
```

Verify:
```bash
aws sts get-caller-identity
```

### Connect to EC2 via SSM

```bash
# Get instance ID
aws ec2 describe-instances \
  --region eu-north-1 \
  --query "Reservations[*].Instances[*].InstanceId" \
  --output text

# Connect
aws ssm start-session --target i-XXXXXXXXXXXXXXXXX --region eu-north-1
```

---

## Step 6 — Launch RDS PostgreSQL

`Services → RDS → Create database`

- **Method:** Standard create
- **Engine:** PostgreSQL 16.x
- **Template:** Free tier
- **DB instance identifier:** `vibemeter-db`
- **Master username:** `vibemeter`
- **Master password:** set a strong password, save it in a password manager
- **Instance:** db.t3.micro (auto-selected by free tier template)
- **Storage:** 20 GB gp2, **disable** storage autoscaling
- **Connectivity:**
  - VPC: default
  - Public access: **No**
  - VPC security group: remove default → add `vibemeter-rds-sg`
  - Availability zone: `eu-north-1a` (same as EC2)
- **Additional config:**
  - Initial database name: `vibemeter`
  - Backup retention: 7 days
  - **Disable** Enhanced monitoring
  - **Disable** Multi-AZ (single-AZ is fine for MVP)

Click **Create database**. Takes ~5 minutes. Note the **Endpoint** hostname once available:
`vibemeter-db.xxxxxxx.eu-north-1.rds.amazonaws.com`

### Enable PostGIS on RDS

Connect from EC2 via SSM session:

```bash
# Install psql on EC2
sudo dnf install -y postgresql16

# Connect to RDS
psql -h YOUR_RDS_ENDPOINT -U vibemeter -d vibemeter
```

Inside psql:
```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
\q
```

### Run DB schema migrations

```bash
psql -h YOUR_RDS_ENDPOINT -U vibemeter -d vibemeter \
  -f ~/vibemeter/infra/postgres/init.sql
```

---

## Step 7 — Create SQS Queue

`Services → SQS → Create queue`
- **Type:** Standard
- **Name:** `vibemeter-async`
- Everything else: defaults

Note the Queue URL — used in the API `.env`.

---

## Step 8 — Install Docker + Nginx on EC2

Connect via SSM, then run:

```bash
# Install Docker
sudo dnf install -y docker
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ssm-user
newgrp docker

# Install latest Docker Compose
DOCKER_COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Install latest Buildx
BUILDX_VERSION=$(curl -s https://api.github.com/repos/docker/buildx/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
sudo curl -SL "https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-amd64" \
  -o /usr/local/lib/docker/cli-plugins/docker-buildx
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

# Verify
docker compose version
docker buildx version
```

```bash
# Install Nginx
sudo dnf install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# Create reverse proxy config — use YOUR Elastic IP in the server_name
sudo tee /etc/nginx/conf.d/vibemeter.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name 13.63.7.88.nip.io;   # replace with YOUR_ELASTIC_IP.nip.io

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo nginx -t && sudo systemctl reload nginx
```

### Enable HTTPS with Let's Encrypt (required for iOS 26+)

iOS 26 App Transport Security blocks plain HTTP connections from apps — HTTPS is required even if `NSAllowsArbitraryLoads` is set. Use `nip.io` (free wildcard DNS) with a free Let's Encrypt certificate:

```bash
# nip.io automatically resolves YOUR_ELASTIC_IP.nip.io → YOUR_ELASTIC_IP
# No signup or DNS configuration needed

# Install certbot
sudo dnf install -y certbot python3-certbot-nginx
# If dnf doesn't have it, use pip:
# sudo python3 -m pip install certbot certbot-nginx
# sudo ln -s /usr/local/bin/certbot /usr/bin/certbot

# Obtain SSL certificate (port 80 must be open for HTTP-01 challenge)
sudo certbot --nginx -d 13.63.7.88.nip.io \   # replace with YOUR_ELASTIC_IP.nip.io
  --non-interactive --agree-tos \
  --email YOUR_EMAIL@example.com
```

Certbot automatically updates the Nginx config to serve HTTPS and redirect HTTP → HTTPS. The certificate lasts 90 days and auto-renews via a cron job certbot installs.

Verify from your iPhone browser:
```
https://13.63.7.88.nip.io/health   # should return {"status":"ok"} with a padlock
```

### Add swap space (prevents OOM on t3.micro)

```bash
sudo dd if=/dev/zero of=/swapfile bs=128M count=16
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile swap swap defaults 0 0' | sudo tee -a /etc/fstab
free -h
```

---

## Step 9 — Build Images Locally and Push to Docker Hub

The t3.micro (1 GB RAM) cannot reliably compile Go or install TensorFlow — it runs out of memory. Build both images on your Mac and push to Docker Hub instead.

### Create Docker Hub account

Sign up at `hub.docker.com` (free). Note your username.

### Build and push both images from your Mac

```bash
# Login to Docker Hub
docker login

cd /path/to/vibemeter

# Build Go API for Linux AMD64 (EC2 is x86_64; Mac is arm64 — must cross-compile)
docker buildx build --platform linux/amd64 \
  -t YOUR_DOCKERHUB_USERNAME/vibemeter-api:latest \
  ./api --push

# Build YAMNet sidecar (Python + TensorFlow) — also too heavy to build on EC2
docker buildx build --platform linux/amd64 \
  -t YOUR_DOCKERHUB_USERNAME/vibemeter-yamnet:latest \
  ./infra/yamnet --push
```

---

## Step 10 — Deploy VibeMeter on EC2

### Clone the repo on EC2

```bash
# Inside SSM session
sudo dnf install -y git
git clone https://YOUR_GITHUB_TOKEN@github.com/imhanda/vibemeter.git ~/vibemeter
```

> To create a GitHub Personal Access Token:
> `GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token`
> Select **repo** scope. Use the token in the clone URL above.

### Create production Docker Compose file

```bash
cat > ~/vibemeter/docker-compose.prod.yml << 'EOF'
services:
  redis:
    image: redis:7
    restart: unless-stopped

  yamnet:
    image: YOUR_DOCKERHUB_USERNAME/vibemeter-yamnet:latest
    restart: unless-stopped
    ports:
      - "8082:8082"

  api:
    image: YOUR_DOCKERHUB_USERNAME/vibemeter-api:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    env_file: .env
    depends_on:
      - redis
      - yamnet
EOF
```

> **Do not use `build: ./infra/yamnet`** — TensorFlow OOMs the t3.micro during build.
> Use the pre-built Docker Hub image instead.

### Create `.env` file

```bash
cat > ~/vibemeter/.env << 'EOF'
DATABASE_URL=postgres://vibemeter:YOUR_RDS_PASSWORD@YOUR_RDS_ENDPOINT:5432/vibemeter?sslmode=require
REDIS_URL=redis://redis:6379
FIREBASE_PROJECT_ID=vibemeter-eebb6
GOOGLE_PLACES_API_KEY=YOUR_KEY
GOOGLE_WEB_CLIENT_ID=YOUR_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_SECRET
ANTHROPIC_API_KEY=YOUR_KEY
YAMNET_URL=http://yamnet:8082
SKIP_AUTH=true
SKIP_GEO_FENCE=true
PORT=8080
EOF
```

Fill in `YOUR_RDS_PASSWORD`, `YOUR_RDS_ENDPOINT`, and `ANTHROPIC_API_KEY`.
The Google/Firebase values are in your local `infra/.env`.

### Login to Docker Hub on EC2 and start services

```bash
cd ~/vibemeter
sudo docker login

# Pull all images from Docker Hub
sudo docker compose -f docker-compose.prod.yml pull

# Start everything
sudo docker compose -f docker-compose.prod.yml up -d
```

> YAMNet downloads the TF Hub model (~17 MB) on first startup. Wait ~30 seconds before testing audio analysis. Check readiness with:
> ```bash
> sudo docker compose -f docker-compose.prod.yml logs yamnet --tail 5
> # Ready when you see: "YAMNet ready — 521 classes"
> ```

---

## Step 11 — Verify API

```bash
# From your local Mac
curl https://YOUR_ELASTIC_IP.nip.io/health
# Expected: {"status":"ok"}

# Check running containers on EC2
sudo docker compose -f docker-compose.prod.yml ps

# Tail API logs
sudo docker compose -f docker-compose.prod.yml logs -f api
```

---

## Step 12 — Point Mobile App at AWS and Build on iPhone via Xcode

### API URL and auth config

`mobile/src/config.ts` is hardcoded to the nip.io HTTPS endpoint:

```
https://YOUR_ELASTIC_IP.nip.io
```

Update `13.63.7.88` in `config.ts` to your Elastic IP if it changes.
iOS 26 App Transport Security requires HTTPS — nip.io provides a valid hostname
for free so no certificate setup is needed.

`SKIP_AUTH=true` in `config.ts` makes the app send `X-User-ID: dev-user` instead
of a Firebase JWT. The EC2 `.env` also has `SKIP_AUTH=true` so the API accepts it.
Flip both to `false` when you enable real Firebase auth.

### Build and install on physical iPhone

Plug your iPhone into your Mac via USB, unlock it, and tap **Trust This Computer** when prompted. Then run:

```bash
cd mobile
npx expo run:ios --device
```

When it shows a picker, select your physical iPhone (not the simulator):

```
? Select a device ›
  ❯ Vipin's iPhone        ← select this
    iPhone 17 Pro (simulator)
```

- First build: 5–10 minutes
- Subsequent builds: 1–2 minutes
- The app installs and opens on your iPhone automatically

> If iPhone prompts **"Developer Mode required"**:
> `Settings → Privacy & Security → Developer Mode → Enable` → restart iPhone → re-run the command

### Using Xcode instead of the CLI

If you prefer to build from Xcode directly:

```bash
open mobile/ios/VibeMeter.xcworkspace
```

Always open `.xcworkspace`, **not** `.xcodeproj` — CocoaPods only loads via the workspace.

In Xcode:
1. Click **VibeMeter** in the left sidebar → **Signing & Capabilities** tab
2. Check **Automatically manage signing**
3. Set **Team** to your Apple ID (`Xcode → Settings → Accounts → +` to add one)
4. Select your iPhone from the device dropdown in the toolbar
5. Press **`Cmd + R`** to build and install

### Verify requests hit AWS

Once the app opens, check it's talking to EC2:

```bash
curl https://13.63.7.88.nip.io/health
# Expected: {"status":"ok"}
```

---

## Live Log Tailing via SSM

Always use an interactive SSM session for tailing logs — it streams in real time.

```bash
aws ssm start-session --target YOUR_INSTANCE_ID --region eu-north-1
```

Once inside the session:

```bash
# Tail Nginx access log (shows every HTTP request hitting the server)
sudo tail -f /var/log/nginx/access.log

# Tail API container logs (shows Go handler output, DB errors, GIN request log)
sudo docker logs vibemeter-api-1 -f --tail 20

# Tail both at once in separate panes, or run one then Ctrl+C and switch
```

**Reading Nginx logs:**
- Your iPhone's IP will appear on every request the app makes
- Status `200` = success, `404` = route not found, `500` = API error, `502` = API container down
- If your iPhone IP never appears → the app is not reaching EC2 (ATS/network issue)

**Reading API logs:**
- `[GIN] 200 | GET /v1/places/nearby` = successful venue fetch
- `[GIN] 500 | ...` = check the line above it for the DB/Redis error message
- `Connected to Redis` / `Connected to DB` on startup = services are healthy

**Find your iPhone's IP:**
Open Safari on iPhone → go to `https://13.63.7.88.nip.io/health` → then check Nginx log for the most recent entry — that IP is your phone.

You should see `[GIN] 200 | GET /v1/places/nearby` as the home screen loads.

### Re-deploying after changes

| What changed | What to do |
|---|---|
| Go API code | Rebuild Docker image on Mac → push to Docker Hub → pull on EC2 (see Updating section) |
| Mobile JS/TS only | `npx expo run:ios --device` or `Cmd + R` in Xcode |
| `mobile/.env` changed | `npx expo run:ios --device` (env is baked in at build time) |

---

## Updating the App (Future Deploys)

> **This is now automated for API changes** — pushing to `main` with changes
> under `api/**` triggers `.github/workflows/deploy.yml`, which does
> everything below for you. See `DEPLOY_PIPELINE.md` for how it works and
> its rollback procedure. The manual steps here are still accurate and
> useful as a fallback if the pipeline itself is broken, or for debugging.

When you push new API code to GitHub:

**On your Mac:**
```bash
cd /path/to/vibemeter
docker buildx build --platform linux/amd64 \
  -t YOUR_DOCKERHUB_USERNAME/vibemeter-api:latest \
  ./api --push
```

**On EC2 via SSM:**
```bash
cd ~/vibemeter
git pull origin main
sudo docker compose -f docker-compose.prod.yml pull api
sudo docker compose -f docker-compose.prod.yml up -d --no-deps api
```

---

## Cost Summary (Phase 1)

| Component | Month 1–12 | Month 13+ |
|---|---|---|
| EC2 t3.micro | Free | ~$8.50 |
| EBS 30GB gp2 | Free | ~$2.40 |
| RDS db.t3.micro | Free | ~$13 |
| Elastic IP (attached) | Free | Free |
| SQS (1M req/mo) | Free | Free |
| Nginx + Let's Encrypt | Free | Free |
| **Total** | **~$0–2/mo** | **~$24–26/mo** |

---

## Troubleshooting

**SSM TargetNotConnected**
→ EC2 Instance Connect via browser → run `sudo systemctl start amazon-ssm-agent`
→ Verify `AmazonSSMManagedInstanceCore` is attached to the EC2 IAM role

**Docker build freezes / OOM on EC2**
→ Add swap space (see Step 8) and build images one at a time
→ Better: build on Mac and push to Docker Hub (see Step 9)

**RDS connection refused**
→ Confirm `vibemeter-rds-sg` inbound rule source is the EC2 security group ID, not an IP

**`go mod download` fails with go version error**
→ Ensure `api/go.mod` says `go 1.25` and `api/Dockerfile` uses `FROM golang:1.25-alpine`

**`docker compose` permission denied on Docker socket**
→ Run with `sudo` or add user to docker group: `sudo usermod -aG docker ssm-user && newgrp docker`

**API container keeps restarting — Redis connection refused**
→ Containers cannot reach each other via `localhost`. Use the Docker service name instead.
→ In `.env` on EC2: `REDIS_URL=redis://redis:6379` and `YAMNET_URL=http://yamnet:8082`
→ Fix and restart: `sudo docker compose -f docker-compose.prod.yml up -d --no-deps api`

**502 Bad Gateway from Nginx**
→ Nginx is up but the API container is not. Check: `sudo docker compose -f docker-compose.prod.yml ps`
→ If API shows "Restarting", check logs: `sudo docker logs vibemeter-api-1 --tail 30`

**App shows "Network request failed" but Safari can reach the server**
→ iOS App Transport Security (ATS) requires HTTPS. The app uses `https://YOUR_IP.nip.io` — confirm `mobile/src/config.ts` has the correct nip.io URL
→ If you see an ATS error in logs and can't use nip.io, `mobile/app.json` `infoPlist` sets `NSAllowsArbitraryLoads: true` as a fallback — rebuild after any `app.json` change
→ Delete the old app from iPhone before installing the new build to avoid running a cached version

**No requests appear in Nginx log when app loads**
→ App is not reaching EC2 at all — likely wrong URL baked into build or ATS blocking
→ Verify `mobile/src/config.ts` returns `https://13.63.7.88.nip.io` and rebuild
→ Open Safari on iPhone → `https://13.63.7.88.nip.io/health` — if this works, network is fine and the issue is in the app build

**"Audio analysis service unavailable" after recording**
→ The API cannot reach the YAMNet container. Most common cause: `YAMNET_URL=http://localhost:8082` in `.env` — `localhost` inside a container refers to that container itself, not the yamnet sidecar.
→ Must be: `YAMNET_URL=http://yamnet:8082` (Docker service name as hostname)
→ Fix and restart: `sudo docker compose -f docker-compose.prod.yml up -d --no-deps api`
→ Verify connectivity from inside the API container: `sudo docker exec $(sudo docker ps -q --filter "name=api") wget -qO- http://yamnet:8082/health`

**Home screen never loads venues (no network request reaches Nginx)**
→ The `useLocation` hook left `loading: true` permanently when location permission was denied, blocking the `load()` call in VenueListScreen.
→ This was fixed in `mobile/src/hooks/useLocation.ts` — `setLoading(false)` is now called before the early return on permission deny.
→ If you see this again after changes, check that `useLocation` always reaches `setLoading(false)` in both the permission-denied and GPS-error paths.

**Home screen loads but shows only Bengaluru venues regardless of location**
→ `VenueListScreen` was using `DEFAULT_LOCATION` (hardcoded Bengaluru coords) instead of the GPS coords from `useLocation`.
→ Fixed: the `load()` callback now uses `coords.lat, coords.lng` from the hook, and `coords` is in the `useCallback` dependency array.
→ Venue data for new locations is fetched automatically from OpenStreetMap Overpass API the first time a location is searched (< 5 venues in DB for that area). First load in a new city may take 2–5 s.

**RDS schema missing / 500 on `/v1/places/nearby`**
→ DB migrations were never applied. Run from EC2 SSM session:
```bash
PGPASSWORD=YOUR_RDS_PASSWORD psql -h YOUR_RDS_ENDPOINT -U vibemeter -d vibemeter -f ~/vibemeter/infra/postgres/init.sql
```
→ Then seed venues (CSV must be present on EC2 — commit with `git add -f` if gitignored):
```bash
PGPASSWORD=YOUR_RDS_PASSWORD psql -h YOUR_RDS_ENDPOINT -U vibemeter -d vibemeter -f /tmp/seed.sql
```
