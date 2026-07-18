# Automated Deploy Pipeline

This explains `.github/workflows/deploy.yml` — what it does, when it runs, and
how to operate it. It automates the manual process documented in
`AWS_DEPLOY.md`'s "Updating the App" section; that section still describes
what happens under the hood and is useful if you ever need to do a step by
hand (e.g. the pipeline is broken, or you're debugging).

---

## What triggers it

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'api/**'
      - 'infra/postgres/**'
  workflow_dispatch:      # manual "Run workflow" button, with an optional sha input
```

A push to `main` only kicks off the pipeline if it touches `api/**` or
`infra/postgres/**`. Mobile-only or docs-only commits don't trigger a
rebuild/redeploy of the backend.

`workflow_dispatch` (Actions tab → **Deploy API** → **Run workflow**) is the
manual trigger, used for two things:
- **Full deploy of current `main`** — leave the `sha` input blank.
- **Rollback** — put a previous commit's SHA in the `sha` input. This skips
  building anything new and redeploys whatever image was already published
  for that commit.

---

## What it does, job by job

```
changes ──┬──> test ──> build-and-push ──> deploy
          └──> migration-lint
```

1. **`changes`** — figures out whether the push touched `api/**` and/or
   `infra/postgres/migrations/**`, so downstream jobs can skip themselves
   when there's nothing relevant to do.

2. **`test`** — `go vet`, `go build`, `go test` in `api/`. This is the gate:
   if it fails, nothing gets built or deployed. Runs on a qualifying push, or
   on a manual "full deploy" dispatch (blank `sha`). Skipped entirely on a
   rollback dispatch (a `sha` is given) — rollback redeploys an
   already-tested, already-built image, so there's nothing new to test.

3. **`migration-lint`** — only runs when `infra/postgres/migrations/**`
   changed. Spins up a throwaway `postgis/postgis:16-3.4` container *inside
   the CI runner* (never touches the real database), loads `init.sql`'s base
   schema (DDL only, stopping before the seed-data section), then replays
   every migration file on top of it with `ON_ERROR_STOP=1` — mirroring how
   migrations actually get applied against RDS (as patches on an existing
   schema, not a standalone bootstrap). It does **not** apply anything to
   the real RDS database — see [Migrations](#migrations-are-not-auto-applied)
   below.

   It also asks Claude (Haiku) to review each **changed** migration file
   (only the files this push actually touched, not the whole directory) for
   risky patterns — `DROP TABLE`/`DROP COLUMN`, `TRUNCATE`, a `NOT NULL`
   added without a default on a populated table, a missing
   `IF NOT EXISTS`/`IF EXISTS` guard, or anything non-idempotent (this
   project's migrations are meant to be safely re-runnable). This is
   **advisory only** — findings are posted to the job's step summary with a
   🟢/🟡/🔴 risk marker, and the step can never fail the build, even if the
   Anthropic API errors or `ANTHROPIC_API_KEY` isn't configured (it just
   notes that it skipped). It's a second opinion to read before you
   manually apply a migration over SSM, not a gate.

4. **`build-and-push`** — builds `api/Dockerfile` for `linux/amd64` (the
   architecture EC2 runs; GitHub's runners are natively `amd64` too, so this
   is a real native build, not cross-compiled) and pushes to Docker Hub as
   both:
   - `vhanda94/vibemeter-api:latest`
   - `vhanda94/vibemeter-api:<git-sha>`

   The deploy step below always uses the `<git-sha>` tag, never `latest` —
   see [Why SHA tags, not `latest`](#why-sha-tags-not-latest).

5. **`deploy`** — authenticates to AWS via OIDC (see
   [Credentials](#how-it-authenticates-to-aws)), then runs the equivalent of
   the old manual SSM session:
   ```
   cd /home/ssm-user/vibemeter
   git fetch origin main
   git reset --hard origin/main
   docker pull <image>
   sed -i ... docker-compose.prod.yml   # pin the api service to <image>
   docker compose -f docker-compose.prod.yml up -d --no-deps api
   curl -sf http://localhost:8080/health
   ```
   Uses `fetch` + `reset --hard` rather than `git pull` — see
   [Why reset --hard, not git pull](#why-reset---hard-not-git-pull).
   via `aws ssm send-command` (there is no SSH on this box — see
   [Why SSM](#why-ssm-instead-of-ssh)) — then polls for the command's result
   and fails the job loudly, with the remote command's stdout/stderr printed
   in the log, if anything went wrong.

   If that fails, a second step (`if: failure()`) automatically collects
   read-only diagnostics from the box — git status, container state, recent
   API container logs, health check, disk usage — the same things you'd
   normally check by hand over SSM after a bad deploy. If `ANTHROPIC_API_KEY`
   is set, it also asks Claude for a plain-English probable cause, primed
   with the specific failure patterns this pipeline has already hit once
   (git ownership, diverged history, missing schema) so it can recognize a
   repeat instantly instead of re-deriving it from scratch. Posted to the
   job's step summary; never changes the job's pass/fail outcome, which is
   already determined by the deploy step itself.

---

## Why SSM instead of SSH

The EC2 instance was deliberately set up without SSH (`AWS_DEPLOY.md` Step
3 — no port 22 open, no key pair). All access goes through AWS Systems
Manager Session Manager / Run Command instead. The pipeline uses the same
mechanism (`aws ssm send-command`) rather than introducing SSH just for CI,
so the server's access model doesn't change because of automation.

One non-obvious wrinkle: an interactive SSM *session* (what a human uses)
runs as `ssm-user` with `~` → `/home/ssm-user`. An automated
`send-command` (what the pipeline uses) runs as `root` with `$HOME` unset —
confirmed by testing directly against the box before wiring this up. That's
why the deploy script `cd`s to the absolute path `/home/ssm-user/vibemeter`
instead of `~/vibemeter`.

## Why `reset --hard`, not `git pull`

The first real run hit this exact problem: the box's checkout had diverged
from `origin/main` (stale commits from before a past history rewrite —
same commit messages, different SHAs throughout). `git pull` refused to
proceed without a configured merge/rebase strategy, and even with one
configured, a genuine divergence would still block the deploy. A deploy
target doesn't need merge semantics — it should always end up as an exact
copy of the target ref, nothing more. `git fetch` + `git reset --hard
origin/main` always succeeds regardless of the box's prior local history,
and only affects git-tracked files: `docker-compose.prod.yml` and `.env`
are both untracked (created manually per `AWS_DEPLOY.md`), so a hard reset
never touches them.

The deploy script also allowlists the repo directory with
`git config --system --add safe.directory` before touching it — an
automated `aws ssm send-command` runs as `root`, but the repo was originally
cloned by `ssm-user`, and Git refuses to operate across that ownership
mismatch by default (a security check, not a bug) unless the directory is
explicitly trusted.

## Why SHA tags, not `latest`

If two deploys ever overlap (e.g. a rollback triggered while a normal deploy
is still running), both pulling `:latest` could race and leave the box
running whichever image happened to finish pushing last — not necessarily
either deploy's intended version. Tagging every build with its commit SHA
and always deploying that exact tag means "what's running" is always
unambiguous, and rollback (redeploying an old SHA) is just reusing the same
mechanism with an older tag — no separate rollback logic needed.

## How it authenticates to AWS

No AWS access keys are stored in GitHub. The workflow uses [OIDC federation](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services):
GitHub mints a short-lived identity token for the run, which assumes IAM role
`vibemeter-ci-deploy-role` in AWS account `528235769463`. That role:
- Can only be assumed by workflow runs from `repo:Imhanda/vibemeter` on
  `ref:refs/heads/main` (trust policy condition) — a workflow run from a fork
  or another branch cannot assume it.
- Can only call `ssm:SendCommand` against this one EC2 instance and the
  `AWS-RunShellScript` document, plus read the status of commands it sent.
  It cannot touch any other AWS resource in the account.

There's nothing to rotate — tokens expire automatically per run.

## Migrations are not auto-applied

`infra/postgres/migrations/*.sql` files are linted in CI (see `migration-lint`
above) but never run against the real RDS database automatically. Two
reasons:
- RDS has no public network access — GitHub's runners have no path to it
  except by relaying through the EC2 box, same as the deploy step does.
- Today's migrations are safe (`CREATE ... IF NOT EXISTS`), but nothing
  enforces that a future one will be. For a low schema-change frequency,
  the safety of a deliberate, human-run step outweighs the convenience of
  automating it.

Apply migrations the same way described in `AWS_DEPLOY.md`'s
troubleshooting section — over an SSM session, by hand, when you're ready:
```bash
psql -h YOUR_RDS_ENDPOINT -U vibemeter -d vibemeter -f infra/postgres/migrations/00X_*.sql
```

---

## One-time setup (already done / still needed)

**Already provisioned in AWS** (nothing to do here):
- OIDC identity provider for `token.actions.githubusercontent.com`
- IAM role `vibemeter-ci-deploy-role` and its scoped permissions policy

**Still required — GitHub repo settings** (Settings → Secrets and variables → Actions):

| Type | Name | Value |
|---|---|---|
| Secret | `DOCKERHUB_USERNAME` | `vhanda94` |
| Secret | `DOCKERHUB_TOKEN` | A Docker Hub access token (Read & Write) — hub.docker.com → Account Settings → Security |
| Variable | `AWS_REGION` | `eu-north-1` |
| Variable | `EC2_INSTANCE_ID` | `i-098ccd472a6d017e5` |
| Variable | `AWS_ROLE_ARN` | `arn:aws:iam::528235769463:role/vibemeter-ci-deploy-role` |
| Secret | `ANTHROPIC_API_KEY` | Optional — same key the backend uses (`config.C.AnthropicAPIKey`). Only needed for the `migration-lint` job's Claude risk review; everything else works without it. If unset, that one step just notes it skipped — nothing fails. |

Until the first five are set, `test` and `build-and-push` succeed but `deploy`
fails (expected) — re-run the failed job once they're in place.

---

## How to roll back

Actions tab → **Deploy API** → **Run workflow** → put a previous commit's
SHA in the `sha` input → **Run workflow**. This redeploys that commit's
already-published image without rebuilding anything.

## Troubleshooting

**`deploy` job fails, `test`/`build-and-push` passed** — almost always
either the GitHub secrets/variables aren't set yet, or the IAM role's trust
policy doesn't match (check you're pushing to `main`, not another branch).
The job log prints the remote command's stdout/stderr — that's usually
enough to tell whether it's an AWS auth issue (fails before reaching SSM) or
something failing on the box itself (e.g. `docker pull` auth, health check
timeout).

**`fatal: detected dubious ownership in repository`** — this shouldn't
recur; the deploy script now allowlists `/home/ssm-user/vibemeter` with
`git config --system --add safe.directory` before every deploy. If you see
it anyway (e.g. after the box was rebuilt), it means that config is missing;
the workflow will fix it on its own next run since the check is in the
script itself, not a one-time manual step.

**Divergent branch / non-fast-forward errors** — shouldn't happen anymore
either, since the deploy script uses `git reset --hard origin/main` instead
of `git pull` (see [Why reset --hard, not git pull](#why-reset---hard-not-git-pull)).
If you ever need to do this by hand over SSM: `git fetch origin main && git
reset --hard origin/main` — safe to run any time, since `docker-compose.prod.yml`
and `.env` are untracked and unaffected by it.

**Deploy "succeeds" but the app doesn't seem updated** — over SSM, check
`grep image: docker-compose.prod.yml` to see which tag the `api` service is
actually pinned to, and `docker compose -f docker-compose.prod.yml ps` to
confirm the running container matches it — compare against the SHA the
workflow run says it deployed.

**Need to see exactly what ran on the box** — every `deploy` job run prints
the SSM `CommandId` it created; you can also inspect it directly with
`aws ssm get-command-invocation --command-id <id> --instance-id i-098ccd472a6d017e5 --region eu-north-1`.
