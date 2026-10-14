# Deploying Aisle for free

Aisle runs entirely on free tiers. No paid service is required for any feature:

| Piece | Free option | Notes |
|---|---|---|
| Web app | **Vercel Hobby** | Personal, non-commercial use under Vercel's terms |
| Database | **Neon** free Postgres | Scales to zero when idle |
| Hourly monitoring | **GitHub Actions** cron (`.github/workflows/monitor.yml`) | Runs `pnpm worker:once` |
| Redis | Not needed | The cache lives in Postgres when `REDIS_URL` is unset |
| Live Amazon data | **Amazon Creators API**, free with an approved Associates account | Optional. Without it, Aisle runs in labelled demo mode |
| Email alerts | **Resend** free tier | Optional. In-app notifications always work |
| Insight briefings | Built in | Free. An Anthropic API key only changes the wording and is billed separately, so it is optional |

Aisle switches modes based on whether `REDIS_URL` is set:

- **Unset (free stack):** monitoring runs on a schedule and manual refreshes run inline.
- **Set:** a long-running BullMQ worker handles both (see [Self-hosting with Docker](#self-hosting-with-docker-also-free)).

---

## Step by step: Vercel + Neon + GitHub Actions

Plan on about 20 minutes, all in the browser. You need accounts on GitHub, [Vercel](https://vercel.com) and [Neon](https://neon.tech); signing in to both with GitHub is easiest.

### 0. Put the code on your default branch

Vercel deploys production from the default branch, and GitHub only runs scheduled workflows on the default branch. Merge the Aisle branch into `main` first, or make it the default branch.

### 1. Create the database (Neon)

1. Click **New project**, name it `aisle`, and pick Postgres 16 or newer.
2. Choose a region close to your Vercel functions. Vercel defaults to Washington, D.C. (`iad1`), so pick **AWS US East (N. Virginia)** unless you change Vercel's region.
3. Open **Connect** and copy two connection strings:
   - **Pooled** ("Connection pooling" on; the host contains `-pooler`). This goes to **Vercel**.
   - **Direct** (pooling off). This goes to **GitHub Actions**.

Paste both exactly as Neon shows them. Aisle removes the `channel_binding` parameter, which the Node driver rejects, and turns off prepared statements on pooled hosts automatically.

### 2. Generate an auth secret

```bash
openssl rand -base64 32
# or: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Any random string of 32 or more characters also works, for example from a password manager.

### 3. Deploy the web app (Vercel)

1. Go to **Add New → Project** and import the repository. Vercel detects Next.js and pnpm automatically.
2. Before deploying, add these **Environment Variables**:

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string |
| `BETTER_AUTH_SECRET` | the secret from step 2 |
| `BETTER_AUTH_URL` | `https://<project-name>.vercel.app`, your production URL (correct it after the first deploy if it differs) |
| `DATA_PROVIDER` | `auto` |
| `SIGNUP_ALLOWLIST` | your email, e.g. `you@gmail.com` (or `@yourcompany.com`). Without it, anyone with the URL can register. |
| `DEMO_ACCOUNT_ENABLED` | `true` shows "Explore the demo workspace" on sign-in. The demo login is public by design. |

3. Click **Deploy**.
4. Open **Settings → Domains** and copy the production domain. If it doesn't match `BETTER_AUTH_URL`, update the variable and redeploy (**Deployments → ⋯ → Redeploy**).

> Sign-in cookies are tied to `BETTER_AUTH_URL`, so always use the production domain, not a preview URL.

### 4. Connect GitHub Actions

In the repository, open **Settings → Secrets and variables → Actions**.

**Secrets:**

| Secret | Value |
|---|---|
| `DATABASE_URL` | Neon **direct** connection string |
| `BETTER_AUTH_SECRET` | same value as on Vercel |
| `BETTER_AUTH_URL` | same value as on Vercel |
| `CREATORS_API_CREDENTIAL_ID`, `CREATORS_API_CREDENTIAL_SECRET`, `CREATORS_API_CREDENTIAL_VERSION`, `CREATORS_API_PARTNER_TAG` | *optional*, see [Live Amazon data](#live-amazon-data-amazon-creators-api-free) |
| `RESEND_API_KEY` | *optional*, see [Email](#email-alerts-resend-free-tier) |

**Variables:**

| Variable | Value |
|---|---|
| `AISLE_SCHEDULED_MONITORING` | `true` |
| `EMAIL_FROM` | *optional*, e.g. `Aisle <alerts@yourdomain.com>` |
| `CREATORS_API_LICENSE_ACK` | *optional*, see below |
| `OBSERVATION_RETENTION_DAYS` | *optional*, e.g. `180` to stay well inside Neon's free storage |

### 5. Create the tables, and the demo workspace if you want it

Open **Actions → Set up database → Run workflow**. Leave "Also create the demo workspace" ticked if you want it. The workflow applies migrations and seeds the simulated demo, and is safe to re-run.

<details><summary>From a terminal instead</summary>

```bash
corepack enable && pnpm install
DATABASE_URL="<neon direct url>" pnpm db:migrate
DATABASE_URL="<neon direct url>" pnpm db:seed     # optional demo workspace
```
</details>

### 6. Turn on hourly monitoring

The **Hourly monitoring** workflow runs at minute 7 of every hour once `AISLE_SCHEDULED_MONITORING` is `true`. Each run:

1. applies any new migrations (so merging a branch that adds one migrates production within the hour; see [the release checklist](BRAND_INTELLIGENCE.md#production-release-checklist-each-step-needs-explicit-approval));
2. refreshes listings that are due;
3. evaluates alerts;
4. advances queued bulk imports, builds last week's Monday Briefing once, and retries pending emails;
5. records a heartbeat.

The 03:07 UTC run also sends digests, runs scheduled reports and applies retention.

Start the first run by hand with **Actions → Hourly monitoring → Run workflow**. In the app, the toolbar dot then turns green and reads **Scheduled · hourly**, and **Settings → Monitoring** shows the last heartbeat.

### 7. Sign in

Open your domain and sign up with the allow-listed email. Onboarding walks you through the first import.

---

## Optional free connections

### Live Amazon data: Amazon Creators API (free)

Without provider credentials, Aisle runs in **demo mode**:

- Every price is simulated and labelled **Simulated**, in the UI and in every export.
- A real Amazon link imports as a placeholder (`Demo listing · <ASIN>`) with labelled simulated prices. Aisle never invents details for real products.

The Creators API is Amazon's own catalog API for Associates and costs nothing. Amazon grants access only to approved Associates accounts and can require recent qualifying sales, so check Associates Central for your eligibility.

1. In Associates Central, create Creators API credentials. Note the credential ID, secret, credential version and your partner tag (store ID).
2. Add the four `CREATORS_API_*` values as Vercel environment variables (used for imports and manual refreshes) **and** as GitHub secrets (used for hourly monitoring).
3. Keep `DATA_PROVIDER=auto`. Aisle uses the Creators API whenever credentials are present.
4. Open **Settings → Data providers → Test connection**.

The Creators API is **lookup-only by default**: Aisle shows current prices but doesn't store a price history. Set `CREATORS_API_LICENSE_ACK=true` only after confirming that your Associates agreement allows storing and monitoring prices.

> **Status:** the Creators API adapter is implemented against Amazon's published API and covered by fixture-based tests, but it **has not been exercised against a live account**. Until this deployment records a real successful response, the app labels the provider **"Not yet verified live"** and the toolbar shows **"Live · unverified"**. The label changes automatically after the first successful real call. See [PROVIDERS.md](PROVIDERS.md).

### Email alerts: Resend (free tier)

In-app notifications need no setup. For email:

1. Create a free [Resend](https://resend.com) account and an API key.
2. Add `RESEND_API_KEY` on Vercel (powers "Send test") and as a GitHub secret (powers alerts and digests from monitoring runs).
3. Set `EMAIL_FROM`:
   - Without your own domain, use `Aisle <onboarding@resend.dev>`. Resend then delivers only to your Resend account's address.
   - To email anyone, verify a domain in Resend and send from it.

Events based on simulated data are never emailed.

**Settings → Notifications** shows whether email is *live*, in *dry run*, or *not set up*, and why. It has a **Send test email** button that sends to you only, and a delivery log with retry. Set `EMAIL_DRY_RUN=true` on preview or staging deployments to record messages without sending them.

### Insight briefings

The **Brief me** button on Insights always works for free. It assembles a briefing from verified findings, and the pattern detection behind it runs locally:

- robust z-scores for unusual moves;
- regression for trends;
- autocorrelation for promotion cycles;
- k-means for brand segments.

Setting `ANTHROPIC_API_KEY` only lets an AI model reword that briefing. The Anthropic API is billed separately from Claude chat plans, so leave it unset to stay free.

### Custom domain

Add the domain in Vercel under **Settings → Domains**. Then update `BETTER_AUTH_URL` on Vercel and in the GitHub secrets, and redeploy.

---

## Free-tier limits

These are the published free tiers at the time of writing; check each provider for current numbers.

- **Vercel Hobby** is for personal, non-commercial use. A commercial team should self-host (below) or move to a paid plan.
- **Neon free storage** is about 0.5 GB per project.
  - Observations are the main consumer: roughly 500 listings checked hourly adds a few million rows a year. Lower `OBSERVATION_RETENTION_DAYS` (Vercel env and GitHub variable) if you approach the cap.
  - Compute scales to zero, so the first request after an idle period is about a second slower. Aisle shows a loading skeleton during that wait.
- **GitHub Actions:**
  - Public repositories get unlimited minutes. Private repositories on the Free plan get 2,000 minutes a month.
  - Hourly runs take 1–2 minutes each, rounded up per job, which comes to about 750–1,500 minutes a month. If that's too close to the limit, change the cron in `monitor.yml` to `7 */2 * * *` to run every two hours.
  - Scheduled runs can start a few minutes late. Aisle treats the runner as healthy if it reported within two hours.
  - In public repositories, scheduled workflows pause after 60 days without activity. Re-enable them from the Actions tab.
- **Rate limiting** is per server instance, so it is best-effort on serverless hosts.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build fails: `BETTER_AUTH_SECRET must be set in production` | Add it on Vercel for Production (and Preview, if you use previews), then redeploy. |
| `relation "…" does not exist` | Migrations haven't run. Run **Set up database**. |
| Sign-in works but bounces back to sign-in | `BETTER_AUTH_URL` doesn't match the URL you're visiting. |
| "Sign-ups are restricted on this Aisle deployment" | Add the email (or `@domain`) to `SIGNUP_ALLOWLIST`, then redeploy. |
| Toolbar shows **No heartbeat** | Check that `AISLE_SCHEDULED_MONITORING` is a **variable** (not a secret) set to `true`, that the `DATABASE_URL` secret is set, and that the latest *Hourly monitoring* run is green. |
| Monitoring run can't connect | Use Neon's **direct** connection string for the GitHub secret. |
| "Explore the demo workspace" errors | Re-run **Set up database** with the demo box ticked, or set `DEMO_ACCOUNT_ENABLED=false`. |
| Uptime checks | `GET /api/health` reports the database, cache mode and last worker heartbeat. |

---

## Self-hosting with Docker (also free)

This works on any machine you already have, or on a free-forever VM such as Oracle Cloud's Always Free ARM instances:

```bash
git clone <your repo> aisle && cd aisle
cp .env.example .env     # set BETTER_AUTH_SECRET, BETTER_AUTH_URL, SIGNUP_ALLOWLIST …
docker compose --profile app up -d --build
docker compose exec web pnpm db:seed    # optional demo workspace
```

This starts Postgres, Redis, the web app on port 3000 (it applies migrations on boot) and the BullMQ worker. The worker:

- scans for due listings every 5 minutes;
- evaluates system alerts hourly;
- runs maintenance and scheduled reports daily;
- retries failed jobs with exponential backoff.

Put a TLS proxy in front of it, for example `caddy reverse-proxy --from yourdomain.com --to :3000`, and set `BETTER_AUTH_URL` to the https URL. For `output: "standalone"` images, build with `BUILD_STANDALONE=1`.

## Environment reference

Every variable is documented in [`.env.example`](../.env.example). Blank values are treated as unset.
