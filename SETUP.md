# VibeMeter — Setup Guide for a Friend

> This guide assumes you are **not a developer**. Every step is explained in plain English. Follow each part in order and you'll have the app running on your iPhone.

---

## Before You Start — Checklist

Make sure you have all of these before beginning:

- [ ] A **Mac** (MacBook or iMac) running macOS 13 Ventura or newer
- [ ] An **iPhone** running iOS 16 or newer
- [ ] The **USB cable** that came with your iPhone
- [ ] An **Apple ID** — the free one you use for the App Store
- [ ] At least **15 GB of free disk space** on your Mac
- [ ] Your Mac and iPhone connected to the **same Wi-Fi network**
- [ ] The **API keys document** from the project owner (ask them for it)

---

## Part 1 — Open the Terminal App

Almost everything in this guide is done by typing commands in the Terminal — a text-based window that lets you control your Mac.

**How to open it:**
1. Press **Cmd + Space** on your keyboard
2. Type `Terminal`
3. Press **Enter**

A black or white window will open with a blinking cursor. This is where you will type commands.

> **Tip:** When you see a command in a grey box like `this`, click the box to highlight it, then copy and paste it into Terminal. Press Enter after each command to run it.

---

## Part 2 — Install Homebrew (the Mac Tool Installer)

**What it is:** Homebrew is a free program that makes it easy to install developer tools on a Mac. Think of it as a special App Store for developer software — one command and it installs what you need.

**Why it's needed:** We'll use it to install Git, Node.js, and Go in the next steps.

**How to install:**

1. In Terminal, paste this command and press Enter:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. It will ask for your **Mac login password**. Type it and press Enter.
   - Nothing appears on screen while you type — this is normal and intentional for security.
3. It may ask you to press Enter a second time to confirm.
4. Wait for it to finish (2–5 minutes).

**Verify it worked:**

```
brew --version
```

You should see something like `Homebrew 4.x.x`. If you do, move to the next step.

---

## Part 3 — Install Git

**What it is:** Git is a tool for downloading code from the internet. When a project is stored on GitHub, Git is how you "clone" (download) it to your Mac.

**Why it's needed:** We need it to download the VibeMeter project code.

**Install it:**

```
brew install git
```

**Verify it worked:**

```
git --version
```

You should see something like `git version 2.x.x`.

---

## Part 4 — Install Node.js

**What it is:** Node.js is a JavaScript runtime. The VibeMeter mobile app is built with a tool called Expo, which uses Node.js to run its development server. That server is what packages the app code and sends it to your iPhone.

**Why it's needed:** Required to run the Expo bundler and install the app's JavaScript dependencies.

**Install it:**

```
brew install node
```

**Verify it worked:**

```
node --version
npm --version
```

Both should show version numbers (e.g. `v20.x.x` and `10.x.x`).

---

## Part 5 — Install Go

**What it is:** Go (also called Golang) is a programming language. The VibeMeter backend server — the part that handles logins, stores check-ins, and calculates vibe scores — is written in Go.

**Why it's needed:** Without it, you can't start the backend API server that the iPhone app talks to.

**Install it:**

```
brew install go
```

**Verify it worked:**

```
go version
```

You should see something like `go version go1.22.x darwin/arm64`.

---

## Part 6 — Install Docker Desktop

**What it is:** Docker is a tool that runs software services inside isolated "containers" — like little virtual machines. This project uses it to run the database, cache, and audio analysis service without you having to install each one manually.

**What Docker runs for this project:**
| Service | What it does |
|---|---|
| **PostgreSQL** | The main database — stores all venues, users, check-ins, and scores |
| **Redis** | A fast memory store — caches vibe scores and handles rate limiting |
| **YAMNet** | An AI audio classifier — analyses ambient sound recordings from your phone's mic |
| **pgAdmin** | A web interface to view the database (optional, useful for debugging) |

**How to install:**

1. **Find out which chip your Mac has:**
   - Click the Apple logo (🍎) in the top-left corner
   - Click "About This Mac"
   - Look for the word **Chip** or **Processor**
   - If it says "Apple M1", "M2", "M3", or "M4" → you have an **Apple Chip** Mac
   - If it says "Intel Core" → you have an **Intel** Mac

2. **Download Docker Desktop:**
   - Open Safari and go to: `https://www.docker.com/products/docker-desktop/`
   - Click the big blue "Download" button
   - Choose **"Mac with Apple Chip"** or **"Mac with Intel Chip"** based on what you found above

3. **Install it:**
   - Open the downloaded `.dmg` file (it will appear in your Downloads folder)
   - Drag the Docker icon into the Applications folder (a window will show you how)
   - Close the `.dmg` window

4. **First-time setup:**
   - Open **Docker** from your Applications folder (or press Cmd+Space and type "Docker")
   - Click **Accept** on the licence agreement
   - Docker will ask for your Mac login password — enter it. This is needed so Docker can set up its internal networking.
   - Wait for Docker to finish starting up. You will see a small **whale icon** appear in the top menu bar (the strip at the very top of your screen).

5. **How to know Docker is ready:**
   - Look at the whale icon in the menu bar
   - If it's **animated** (moving dots), Docker is still starting — wait
   - If it's **still/solid**, Docker is ready ✓
   - Do not continue until the whale icon is still.

6. **Verify in Terminal:**

```
docker --version
```

You should see something like `Docker version 26.x.x`.

---

## Part 7 — Install Xcode

**What it is:** Xcode is Apple's official app for building iPhone and Mac apps. It includes the tools needed to compile code into an app that can run on your phone.

**Why it's needed:** The VibeMeter app uses Google Sign-In, which requires a native (real) build installed via Xcode. You cannot use the generic Expo Go app for this.

**How to install:**

1. Open the **App Store** on your Mac (blue icon with the letter A)
2. In the search bar, type **Xcode**
3. Click **Install** (it's free, but large — about 10 GB)
4. This can take a long time depending on your internet speed. You can leave it to download overnight.

**First-time setup after install:**

1. Once installed, open **Xcode** from your Applications folder
2. It will say **"Installing additional components"** — let it finish (5–10 minutes)
3. Accept the licence agreement when prompted

**Verify it worked:**

```
xcode-select -p
```

The output should show a path ending in `Xcode.app/...`. If it shows `/Library/Developer/CommandLineTools`, run this to fix it:

```
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

Enter your Mac password when asked.

---

## Part 8 — Download the Project Code

**What "cloning" means:** The project code lives on GitHub (a website that hosts code). Cloning means downloading a full copy of it to your Mac.

**Run these commands one by one:**

```
cd ~/Desktop
```
*(This moves your Terminal into your Desktop folder — the project files will be saved there)*

```
git clone https://github.com/Imhanda/vibemeter.git
```
*(This downloads the entire VibeMeter project from GitHub)*

```
cd vibemeter
```
*(This moves into the project folder you just downloaded)*

After this, a folder called `vibemeter` will appear on your Desktop with all the code inside.

---

## Part 9 — Add Your API Keys

**What API keys are:** Some features (like Google Sign-In and Firebase authentication) require secret keys that connect the app to external services. These keys are private — they are not stored in the public code for security reasons. The project owner (the person who gave you this guide) will provide them.

**How to add them:**

1. Move into the `api` folder:

```
cd ~/Desktop/vibemeter/api
```

2. Create a new file called `.env` using the built-in text editor:

```
nano .env
```

A simple text editor opens inside Terminal.

3. Carefully type or paste the following (replace `PASTE_FROM_ADMIN` with the actual values the owner sent you):

```
FIREBASE_PROJECT_ID=PASTE_FROM_ADMIN
GOOGLE_PLACES_API_KEY=PASTE_FROM_ADMIN
GOOGLE_WEB_CLIENT_ID=PASTE_FROM_ADMIN
GOOGLE_CLIENT_SECRET=PASTE_FROM_ADMIN
ANTHROPIC_API_KEY=PASTE_FROM_ADMIN
SKIP_AUTH=false
GEO_FENCE_RADIUS_M=50000000
```

---

### Developer: How to get these keys

**`GOOGLE_PLACES_API_KEY`**
1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Enable **Places API (New)** at `console.cloud.google.com/apis/library/places.googleapis.com`
3. Create an **API Key**

**`GOOGLE_WEB_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`**
1. Same Credentials page → **Create Credentials → OAuth 2.0 Client ID** (Web application)
2. Copy the Client ID and Client Secret

**`FIREBASE_PROJECT_ID`**
1. [Firebase Console](https://console.firebase.google.com) → Project Settings
2. Copy the **Project ID**

> These values also go in `infra/.env` (used by the seed script — see Part 10a below).

**What each line does:**
| Key | What it's for |
|---|---|
| `FIREBASE_PROJECT_ID` | Connects to Firebase — the service that handles Google Sign-In and verifies user identities |
| `GOOGLE_PLACES_API_KEY` | Allows the app to find and sync real venue data from Google Maps |
| `GOOGLE_WEB_CLIENT_ID` | Identifies this app to Google's authentication system |
| `GOOGLE_CLIENT_SECRET` | A private password that proves this server is allowed to use Google OAuth |
| `ANTHROPIC_API_KEY` | For a future AI-powered feature (venue summaries); the app works without it |
| `SKIP_AUTH=false` | Keeps authentication turned on (do not change this) |
| `GEO_FENCE_RADIUS_M=50000000` | Sets the check-in geofence radius to 50,000 km — effectively disabled, so you can check in from anywhere for testing |

4. **Save the file:** Press **Ctrl + O**, then press **Enter**
5. **Exit the editor:** Press **Ctrl + X**

---

## Part 10 — Start the Backend Services (Docker)

These are the database and other services the app needs to run. Docker starts them all with one command.

1. Navigate to the `infra` folder:

```
cd ~/Desktop/vibemeter/infra
```

2. Start all services:

```
docker compose up -d
```

**What this command does:**
- Reads the `docker-compose.yml` file which describes all 4 services
- **First time only:** Downloads the software images for each service (~3 GB — takes a few minutes, progress shown on screen)
- Starts all 4 containers in the **background** (`-d` stands for "detached", meaning they run silently behind the scenes)
- The database automatically creates all the required tables and loads 61 Bengaluru venue records on first start

3. **Check everything is running:**

```
docker compose ps
```

All 4 services (`vibemeter-postgres`, `vibemeter-redis`, `vibemeter-yamnet`, `vibemeter-pgadmin`) should show **"running"** in the Status column.

4. **Optional — view the database in a browser:**
   Open Safari and go to `http://localhost:5050`
   Login: `vibe@admin.com` / Password: `vibeadmin`
   This is pgAdmin, a visual interface for the database. You don't need this to run the app, but it's useful if you're curious.

---

## Part 10a — (Re)seed Venue Data (optional)

The repo ships with a pre-built `postgres/places_seed.csv` for Bengaluru. If you want to seed a different city or refresh the data:

1. Install the Python dependency (one time):

```
pip3 install requests
```

2. Create `infra/.env` with the keys from Part 9:

```
GOOGLE_PLACES_API_KEY=your_key
FIREBASE_PROJECT_ID=your_firebase_project_id
GOOGLE_WEB_CLIENT_ID=your_google_web_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

3. Run the seed script:

```
source infra/.env
python3 infra/seed_places.py --city "Mumbai" --api-key "$GOOGLE_PLACES_API_KEY"
```

4. Reload the database with the new data:

```
cd infra
docker compose down -v && docker compose up -d
```

> The `--limit` flag controls how many venues are fetched (default 100). Use `--output` to write to a custom CSV path.

---

## Part 11 — Start the API Server

The API server is the Go program that handles all requests from the app — logins, venue lookups, check-ins, vibe scores, and WebSocket connections.

1. Open a **new Terminal tab** so you can leave this running: press **Cmd + T**

2. Navigate to the `api` folder and start the server:

```
cd ~/Desktop/vibemeter/api
```

```
./run.sh
```

**What this command does:**
- Loads all secrets from `infra/.env` (`FIREBASE_PROJECT_ID`, `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, etc.)
- Compiles the Go code (first run only downloads dependencies — ~30 seconds)
- Connects to the PostgreSQL database and Redis cache that Docker started
- Starts a web server on port **8080** that the iPhone app talks to
- Also provides a WebSocket endpoint for real-time vibe score updates to all connected phones

**What you should see:**
```
[GIN-debug] Listening and serving HTTP on :8080
```

> **Important:** Keep this Terminal tab open. If you close it or press Ctrl+C, the server stops and the app will show "Network request failed".

3. **Verify it's working:**
   Open Safari and go to `http://localhost:8080/health`
   You should see: `{"status":"ok"}`

---

## Part 12 — Find Your Mac's Wi-Fi IP Address

The iPhone app doesn't connect to "localhost" — it needs to reach your Mac over Wi-Fi using your Mac's actual network address.

**How to find your IP:**

1. Click the **Wi-Fi icon** (📶) in the top menu bar
2. Click **"Wi-Fi Settings"**
3. Click the small **ⓘ** circle next to your connected network name
4. Find the line labelled **"IP Address"** — it will look like `192.168.x.x` or `10.0.x.x`
5. Write this number down — you'll need it in the next step

---

## Part 13 — Update the App with Your IP Address

The app has a fallback IP address hardcoded for the original developer's machine. You need to change it to yours.

1. Open **Finder** and navigate to your Desktop → `vibemeter` → `mobile` → `src` → `config.ts`
2. Right-click the file → **Open With** → **TextEdit**
3. Find this line:
   ```
   return "http://192.168.1.11:8080";
   ```
4. Replace `192.168.1.11` with your IP address from Part 12. For example:
   ```
   return "http://192.168.1.42:8080";
   ```
5. Save the file: **Cmd + S**

> **Note:** If your router assigns you a new IP address (this can happen after restarting your router or reconnecting to Wi-Fi), repeat this step and rebuild the app.

---

## Part 14 — Install App Dependencies

The app uses many open-source JavaScript libraries. These aren't stored in the repo — they are downloaded on first use.

1. Open a **new Terminal tab**: **Cmd + T**

2. Navigate to the mobile folder:

```
cd ~/Desktop/vibemeter/mobile
```

3. Install all dependencies:

```
npm install
```

**What this does:** Reads the `package.json` file which lists all the libraries the app needs, then downloads them all into a folder called `node_modules`. This is a one-time step (~200 MB, 1–2 minutes).

---

## Part 15 — Connect Your iPhone and Build the App

1. **Plug your iPhone into your Mac** using the USB cable

2. **On your iPhone:** A popup will appear saying **"Trust This Computer?"**
   - Tap **Trust**
   - Enter your iPhone passcode

3. **In the same Terminal tab** (still in the `mobile/` folder), run:

```
npx expo run:ios
```

**What this command does:**
- Takes all the React Native / JavaScript code and compiles it into a real native iOS app
- Automatically opens Xcode in the background to handle the compilation
- Signs the app with your Apple ID so your iPhone accepts it
- Installs the app directly onto your connected iPhone
- Starts the Metro bundler — a local server that delivers app updates to the phone while developing

4. **Apple ID sign-in (first time only):**
   Xcode may open and show a message about needing an account. If it does:
   - Open Xcode from your Applications folder
   - Press **Cmd + ,** to open Settings
   - Click **Accounts**
   - Click the **+** button at the bottom left
   - Select **"Add Apple ID"** and sign in with your Apple ID

5. **Signing error fix:**
   If Xcode shows a red error that mentions "signing" or "provisioning":
   - Click on the error message
   - Click the **"Fix Issue"** or **"Enable Automatic Signing"** button that appears
   - Xcode will set everything up automatically

6. **Wait for the build** — first time takes 5–10 minutes. You'll see progress in Terminal. Subsequent builds are much faster.

7. **When it's done:** The VibeMeter app icon will appear on your iPhone home screen, and the app will open automatically.

---

## Part 16 — Use the App

1. **Open VibeMeter** on your iPhone (if it didn't open automatically)

2. **Sign in with Google:**
   - Tap the "Sign in with Google" button
   - Choose any Google account
   - Accept the permissions

3. **Home screen:** You'll see a list of venues (bars, clubs, restaurants in Bengaluru — these are the seed venues loaded from the database). Browse them and tap any one to see its vibe score.

4. **Check In:**
   - Tap a venue → tap **Check In**
   - Choose **🎤 Listen** mode: records 10 seconds of ambient audio, analyses it with AI, and scores the vibe
   - Or choose **⭐ Rate** mode: pick an emoji to manually rate the vibe
   - Tap **Submit Vibe** — your score is saved and the venue's overall score updates in real time

5. **Profile:** Tap the profile tab to see your check-in stats, trust score, and badges earned

---

## Troubleshooting

**"Network request failed" on the home screen**
→ Your Mac's IP address has changed. Repeat Parts 12 and 13, save the file, then press `r` in the Terminal where the Metro bundler is running (this reloads the app).

**"Trust" popup never appeared on iPhone**
→ Try a different USB cable — many cables only charge and don't carry data. The cable that came in the iPhone box always works.

**iPhone doesn't appear in Xcode**
→ Unplug and replug the cable. In Xcode: Window menu → Devices and Simulators. Your iPhone should appear. If it shows "Unavailable", try restarting your iPhone.

**Docker Desktop won't start / whale icon keeps spinning for more than 5 minutes**
→ Quit Docker Desktop (right-click the whale icon → Quit Docker Desktop), restart your Mac, then open Docker Desktop again.

**`docker compose up` says "port is already allocated" or "address already in use"**
→ Something on your Mac is already using the database port. Restart your Mac to clear it, then start from Part 10.

**App crashes when you tap the microphone button**
→ Go to iPhone **Settings** → scroll down to **VibeMeter** → enable **Microphone**.

**"Too far away" error when checking in**
→ This shouldn't happen with the settings in Part 9 (the geofence is set to cover the whole world). If you see it, confirm the `.env` file was saved correctly and restart the API server.

**Xcode says "No signing certificate" or "No accounts"**
→ Open Xcode → Settings (Cmd+,) → Accounts → click + → Add Apple ID. Sign in with the Apple ID you use for the App Store.

**`npm install` fails with permission errors**
→ Run this first: `sudo chown -R $(whoami) ~/.npm` then try `npm install` again.

---

## Stopping Everything (End of Day)

When you're done using the app:

1. **Stop the API server:**
   Go to the Terminal tab running the API, press **Ctrl + C**

2. **Stop Docker services:**

```
cd ~/Desktop/vibemeter/infra
docker compose stop
```

This pauses all services but keeps your data intact.

> If you want to completely remove everything (fresh start): `docker compose down`
> Warning: this deletes the database — all check-ins and scores will be gone.

---

## Starting Again Next Time

Once everything is installed (Parts 1–7 are permanent — you never repeat them), starting the app each time only takes these steps:

1. **Make sure Docker Desktop is open** (whale icon in the menu bar, solid not animated)

2. **Start the backend services:**

```
cd ~/Desktop/vibemeter/infra
docker compose up -d
```

3. **Start the API server** (in a new Terminal tab):

```
cd ~/Desktop/vibemeter/api
./run.sh
```

4. **Open the app on your iPhone** — it's already installed, just tap the icon.

That's it. The app is ready to use.
