# Magpie Clean Login · 干净登录

[简体中文](README.md) · **English**

[![npm](https://img.shields.io/npm/v/@gruu6y/page-clean-login?style=flat-square&logo=npm)](https://www.npmjs.com/package/@gruu6y/page-clean-login)
[![tag](https://img.shields.io/github/v/tag/Gruu6y/magpie-clean-login?style=flat-square)](https://github.com/Gruu6y/magpie-clean-login/tags)
[![ci](https://github.com/Gruu6y/magpie-clean-login/actions/workflows/ci.yml/badge.svg)](https://github.com/Gruu6y/magpie-clean-login/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

**One sentence: an isolated fingerprint-browser plugin for [magpie](https://usemagpie.ai) that manages multi-account sign-in and credential renewal — giving every account its own pinned browser fingerprint and dedicated network exit so accounts do not get linked together.**

If you only use one account, magpie alone is enough. If you maintain several accounts (for example multiple WorkBuddy, Qoder, or Codex accounts), Clean Login keeps each one isolated as its own machine on its own network.

![Providers page in Clean Login: top tabs, one-time login browser setup, and provider cards ready to sign in](assets/screenshot-providers-en.png)

> **Unofficial plugin notice:** Built and maintained independently by [Gruu6y](https://github.com/Gruu6y/magpie-clean-login) — **not** published by magpie or `magpie-community`. The npm package [`@gruu6y/page-clean-login`](https://www.npmjs.com/package/@gruu6y/page-clean-login) is a magpie plugin distribution package (not a standalone JS library). All code is open source — audit it, open issues, and send pull requests.

> **Important provider notices:**
> - **Claude family (`claude`, `claudecode`, etc.):** **Do not use Claude through this plugin — use `claude-cage` instead.**
> - **Google Antigravity / AGY family (`antigravity`, `agy-cli`, etc.):** Accounts without real paid billing cannot reduce ban risk through this plugin, and using Google AGY providers through magpie is not recommended for now.

<a id="tldr"></a>

## 30-second overview (Humans & Agents)

| Aspect | Shipped fact |
| --- | --- |
| **What it is** | Unofficial magpie page plugin (UI page + local loopback server) + zero-dependency CLI & Agent HTTP API |
| **npm package / repo** | `@gruu6y/page-clean-login` · [GitHub](https://github.com/Gruu6y/magpie-clean-login) |
| **Install (humans)** | magpie → **Plugins** → **Discover** → **Unofficial** → install **Clean Login** |
| **Platforms** | **Windows x64** · **macOS (Apple Silicon fully verified / Intel best-effort)** · **Linux x64 / arm64** |
| **Runtime & browser** | Bun **≥ 1.4.2**; built-in one-time slim Camoufox (`158.0.1-beta.41`, 153–176 MB, sha256-verified) |
| **Core pages** | **Providers** · **Proxy IPs** · **Accounts** · **Guide** (4 languages, live-synced to magpie light/dark theme) |
| **Agent one-step entry** | Default loopback service `http://127.0.0.1:3492`; run `clean-login agent` or `GET /api/agent` (with `x-clean-login-token`) for a compact JSON snapshot; async endpoints support `--wait` / `?wait=<ms>` without polling loops |
| **Hard boundary** | One account, one pinned fingerprint, one exit — **bypasses no verification, registers no accounts, zero telemetry** |

<a id="contents"></a>

## Contents

- [30-second overview (Humans & Agents)](#tldr)
- [What problem this solves](#what)
- [Why use it](#why)
- [Requirements and platform support](#requirements)
- [Install (magpie & npm)](#install)
- [Quick start](#quick-start)
- [Core pages](#tabs)
- [Core features and anti-linking design](#features)
- [Agent & command-line interface (CLI / HTTP API)](#cli)
- [Troubleshooting](#troubleshooting)
- [Privacy, data paths, and environment variables](#privacy)
- [Contributing](#contributing)
- [License](#license)

<a id="what"></a>

## What problem this solves

Normally, signing in to an AI service inside magpie works like this: your system browser opens → you sign in → the credential is written to magpie.

With one account, that is fine. **With the second account, linking risk starts piling up:**

- Providers record more than your IP address: they also see your browser fingerprint (GPU renderer, installed fonts, screen geometry, canvas output, etc.), which together act like a machine ID.
- Signing in to account A and account B in the same browser looks to the provider like **two accounts on one computer**.
- During **renewal** and daily requests sent by magpie afterward, sharing one runtime identity and global exit repeatedly signals that those accounts belong together.

**Clean Login takes a direct approach: lock each account into its own isolated browser identity and dedicated exit.**

| Stage | Without Clean Login | With Clean Login |
| --- | --- | --- |
| Browser identity | All accounts share one fingerprint & cookies | Dedicated persistent profile & pinned fingerprint per account |
| Sign-in & daily exit | Follows system / magpie global setting | Sign-in uses your chosen proxy, then auto-syncs to magpie's per-account exit (hot-reloaded) |
| Sign out & back in | Easily looks like a brand-new machine | Keeps the profile and **reuses the old fingerprint** |
| Credential renewal | Refreshed through one shared runtime | Optional per-account **Renew hosting** silently signs in again on the same fingerprint & exit before expiry |

<a id="why"></a>

## Why use it

**Because magpie deliberately does not do this itself.** magpie's maintainers do not want to work against providers, so nothing in magpie hides the fact that one machine signed in to multiple accounts. That is a product choice, not a bug.

Clean Login fills that exact gap:

1. **One account is one machine.** Each account has its own `identity.json` and persistent browser profile; signing out never discards that identity. When you genuinely want an account to become a brand-new machine, click **Renew fingerprint**.
2. **The exit you pick is the exit that is used.** HTTP/HTTPS proxies carry both the isolated Camoufox browser and the plugin's own `authorize()` / `callback()` requests; choosing "direct" forces direct traffic and never silently falls back to magpie's global proxy. After sign-in, the exit automatically syncs to `accountProxies` in magpie's `providers.json` with hot reload (no magpie restart needed).
3. **Follows your installed providers automatically.** Scans installed magpie provider plugins and magpie's market catalog — no manual list to maintain.

> **Clear boundary:** One account, one fingerprint, one exit. How a provider enforces its policies is still up to the provider — **this plugin bypasses no verification and does not register accounts for you.**

<a id="requirements"></a>

## Requirements and platform support

| Item | Requirement |
| --- | --- |
| Host | [magpie](https://usemagpie.ai) with the Plugins panel |
| OS | **Windows x64 · macOS (Apple Silicon / Intel) · Linux x64 / arm64** |
| Runtime | Bun **≥ 1.4.2** (the bundled CLI alone runs on Node 18+ or Bun) |
| Disk space | **153–176 MB** download depending on platform; ~**1 GB** free space during initial setup (extracted browser + ~213 MB `fpgen` model + 256 MB safety margin), once |
| Network | Only for actions you explicitly trigger: proxy tests, trust-score & identity checks, login browser download, and provider sign-ins |

Measured slim Camoufox (`158.0.1-beta.41`, verified against a pinned sha256 before extraction) sizes per platform:

| Platform & arch | Archive download | Extracted size | Support status |
| --- | --- | --- | --- |
| **Windows x64** (`win32:x64`) | ~176 MB | ~433 MB | Fully verified |
| **macOS Apple Silicon** (`darwin:arm64`) | ~154 MB | ~378 MB | Fully verified (real macOS Camoufox + WKWebView E2E; recommended) |
| **macOS Intel** (`darwin:x64`) | ~162 MB | ~398 MB | Best-effort (Rosetta 2 smoke-tested; picked automatically by process arch) |
| **Linux x64** (`linux:x64`) | ~159 MB | ~395 MB | Fully verified |
| **Linux arm64** (`linux:arm64`) | ~153 MB | ~371 MB | Fully verified |

> **macOS slim archive note:** The slim build removes ~2.1 GB of bundled extra fonts under `Camoufox.app/Contents/Resources/fonts/` from the upstream zip while keeping the stock sentinel/system fonts. Upstream macOS builds are unsigned and the plugin does not notarize them; Gatekeeper does not block downloads without quarantine attributes. See [`scripts/build-slim-artifact.mjs`](scripts/build-slim-artifact.mjs) for the build script and the release's `inventory.json` for checksum provenance. Other architectures are not supported yet — open an [issue](https://github.com/Gruu6y/magpie-clean-login/issues) if you need one.

<a id="install"></a>

## Install (magpie & npm)

### Install inside magpie (recommended)

1. Open magpie → **Plugins** → **Discover** → **Unofficial**.
2. Find **Clean Login** by **Gruu6y** and click **Install** (click **Retry** if the catalog has not synced yet).
3. Open **Clean Login** from the left sidebar.

### About the `@gruu6y/page-clean-login` npm package

- Every tagged release `vX.Y.Z` is automatically published to npm as [`@gruu6y/page-clean-login`](https://www.npmjs.com/package/@gruu6y/page-clean-login) ([version history / Tags](https://github.com/Gruu6y/magpie-clean-login/tags)).
- **For regular users:** This is the distribution package that magpie downloads when installing the plugin — you do **not** need to run `npm install` yourself.
- **For scripts & AI agents:** Once installed in magpie, the plugin bundles a zero-dependency CLI (`bin/clean-login.mjs`) that talks straight to the local server without installing extra packages (see [Agent & command-line interface](#cli)).

<a id="quick-start"></a>

## Quick start

Four steps take about 5 minutes (mostly waiting for the one-time browser download).

### Step 1: prepare the login browser (once)

Open the **Providers** tab and click **Prepare browser** in the top **Login browser setup** card:

- Downloads the platform-matched slim Camoufox (**153–176 MB**, sha256-verified) and the `fpgen` fingerprint model (~1.56 MB) into the plugin's own cache directory, leaving your everyday browser untouched.
- Done when the badge turns **Ready**; you can cancel mid-way or retry on failure.

### Step 2: add and test proxy exits

Switch to **Proxy IPs**:

- **Single proxy:** Click **+ Add Proxy** and enter a name, protocol (HTTP / HTTPS / SOCKS5), host, port, and optional credentials (IPv6 supported).
- **Bulk import:** Click **Bulk import** and paste one proxy per line (`http://user:pass@host:port#label`, `label|url`, `host:port`, `host:port:user:pass`, `user:pass@host:port`, `#` / `//` comments supported). Up to 200 lines per batch with automatic duplicate skipping, default protocol, and optional name prefix.
- **Test & verify:** Click **Test** on a row or **Test all** at the top (cancellable anytime).

![Proxy IPs page: test target picker at top right, measured exit results, region filters, and row actions](assets/screenshot-proxies-en.png)

Details worth knowing:

- **Test target:** Defaults to "General (exit check)" which reports real exit IP, region, and latency; switch to a specific provider to measure round-trip latency straight to **that provider's API host**.
- **`~` handshake marker:** A tilde like `~512 ms` on `JP Static 01` means the TLS handshake succeeded but no HTTP response arrived (commonly due to WAF blocking) — a lower-bound reference rather than a full request time.
- **Never silently falls back:** Unreachable or unauthorized proxies always report an error instead of quietly falling back to a direct connection.

### Step 3: pick a provider and sign in

Return to **Providers**, filter by search or category (**All / Signable / Has accounts / Catalog**), and click **Add account** on the target card:

1. **Choose an exit:** The dropdown shows measured latencies and sorts exits **not yet used with this provider** first.
2. **Choose method / fill fields:** If the provider exposes multiple sign-in methods (web login, team edition, desktop session reuse, paste key) or requires inputs (phone number, site URL, API key), fill them in and click **Start sign-in**.
3. **Complete sign-in:** Browser flows open an isolated window and finish automatically once done (closing the window cancels); one-time verification code flows prompt for the code right in the dialog.
4. Once complete, the credential lands in magpie and the account's exit automatically syncs to magpie's `providers.json` with hot reload.

> No **Add account** button on a card? The card explains why — usually the catalog plugin is not installed in magpie yet (install it from the card or via `market install`), or the plugin does not expose a drivable sign-in flow.

### Step 4: verify identity cleanliness on the Accounts tab

Switch to **Accounts** to inspect each account's pinned fingerprint, credential expiry countdown, last sign-in exit, effective exit, identity-check grade, and renew-hosting state.

![Accounts page: filter by provider, A/B/C/D verdict legend, pinned fingerprints, and last sign-in exits](assets/screenshot-accounts-en.png)

- **Identity check:** Click **Check** → **Start check** on a row. Clean Login opens `who.1ms.dog` inside that account's pinned fingerprint and exit, returning **A Clean · ready to use / B Usable · some traces / C Change the exit / D Do not use this exit**. On C or D, switch to a cleaner exit and sign in again.
- **Normal re-login vs. Renew fingerprint:** An ordinary sign-in again **reuses the old fingerprint**. Only clicking **Renew fingerprint** draws a new fingerprint and removes the old browser profile (and only after preflight checks and browser launch readiness succeed, so failures never corrupt the old profile); the account and credentials stay intact.

> **Disclaimer:** `who.1ms.dog` is a third-party second opinion — **it is not a provider risk-control verdict and not a fingerprint score built by this plugin.**

<a id="tabs"></a>

## Core pages

| Page | Purpose & capabilities |
| --- | --- |
| **Providers** | Lists installed provider plugins and magpie's market catalog; supports search and category filters (All / Signable / Has accounts / Catalog), one-time login browser setup, specialized provider risk notices, and one-click **Report a problem** (assembles a scrubbed, credential-free GitHub Issue draft locally). |
| **Proxy IPs** | Manages HTTP / HTTPS / SOCKS5 exits; supports single add & **Bulk import** (up to 200/batch with auto-dedup), row **Test** & **Test all**, provider-targeted latency probes, Claude trust score (`ip.net.coffee/claude`, 0–100), and combined filters by region, latency range, search, status (Available / Failed / Untested), usage (In use / Unused), and sorting. |
| **Accounts** | Displays each account's pinned fingerprint, expiry countdown, sign-in/effective exit, and check history; supports **Import** of existing magpie accounts (covering both `plugin-auth.json` and `logins.json`, with shared plan/run logic); filter by provider (including searchable **More providers**), status (Signed in / Signed out / Renewal paused / Expiring soon), search, and sort; supports per-account exit overrides (inherit / direct / custom), notes, `who.1ms.dog` checks, **Renew hosting**, and **Renew fingerprint**. |
| **Guide** | Built-in 11-section first-time manual written natively in English, 简体中文, 繁體中文, and 日本語; static in-page guide with zero network calls. |

![Guide page: the first section of the 11-part built-in manual explaining why Clean Login exists](assets/screenshot-guide-en.png)

> **About the README screenshots:** Every screenshot in both the English and Chinese READMEs is rendered directly from this repository's real UI in Chrome — no hand-drawn mockups or composites. To avoid exposing anything from the generating machine, only **demo data** is seeded: proxies and accounts use RFC 5737 documentation-reserved IPs (`203.0.113.x`, `198.51.100.x`, `192.0.2.x`) and invented names, and the browser setup panel uses **neutral values** (`C:\Users\Public\…` and `256 GB`). All badges, sizes, provider cards, icons, and copy are computed by the shipped code. Reproduce both sets with `bun scripts/shoot-readme-screenshots.mjs --lang en` / `--lang zh-Hans` ([`scripts/shoot-readme-screenshots.mjs`](scripts/shoot-readme-screenshots.mjs)).

<a id="features"></a>

## Core features and anti-linking design

### Sign-in & anti-linking hardening

- **Consistent two-leg egress:** HTTP/HTTPS proxies carry both the Camoufox browser and the plugin's own `authorize()` / `callback()` HTTP requests; "direct" explicitly bypasses magpie's global proxy. **SOCKS5 proxies carry the browser window only** (due to Bun `fetch` proxy protocol limits) — the UI and status show an explicit non-fatal notice; use an HTTP/HTTPS proxy when both legs must share the exact same exit.
- **Automatic per-account exit sync to magpie:** After sign-in, Clean Login updates `providers[].accountProxies` in magpie's `providers.json`, which magpie hot-reloads without restarting. Switching back to direct clears stale proxy bindings to `"direct"`; editing proxy connection details or passwords automatically re-syncs bound accounts; deleting an account cleans up its exit override and hosting policy; startup backfill only fills missing entries without overwriting manual edits in magpie.
- **Safe fingerprint rotation:** **Renew fingerprint** rotates and deletes the old profile only after plugin loading, input validation, `authorize()`, and browser executable checks all pass — preflight failures never destroy the existing identity.
- **Multi-flow sign-in support:** Supports OAuth browser flows, device codes, SMS/email one-time codes (with timeout cleanup and profile protection while waiting), multi-method selection, and magpie built-in native sign-ins (automatically capturing printed OAuth URLs).
- **Scrubbed issue reporting:** **Report a problem** builds a credential-free, allowlisted GitHub Issue body locally for full preview before opening GitHub (see [docs/reporting.md](docs/reporting.md)).

### Renew hosting (off by default, opt-in per account)

- **Off by default — no global enable-all switch:** Renewal is only taken over after you open **Renew hosting** for a specific account on the **Accounts** tab and click **Enable hosting**.
- **Silent renewal on the same fingerprint & exit:** Before the credential expires, Clean Login runs a headless complete sign-in for that account — reusing the exact same `identity.json`, persistent profile, and recorded exit (direct stays direct) — and writes the new credential back to magpie through the same lock as manual sign-in.
- **Never races magpie's refresh token:** Hosted renewal performs a full sign-in (authorize → callback) rather than consuming refresh tokens; if magpie refreshes first, Clean Login reads the updated expiry and defers automatically.
- **Adaptive lead time by credential lifetime:** ~1-hour credentials start 15 minutes early; ~1-day credentials start ~72 minutes early (5%, clamped to 15 min – 12 h); ≥10-day credentials start **5 days early** to leave plenty of retry headroom.
- **Guardrails & auto-pause:** Strictly serialized (never runs concurrently with manual sign-ins or identity checks); ≥30-minute gap between attempts for the same account with **no daily cap**; pre-expiry transient errors back off and retry instead of shutting off; auto-pauses and surfaces a top banner only when human interaction is required (CAPTCHA / device code / OTP), when the returned account identity mismatches the pinned account, or after repeated failures past expiry.
- The dialog supports **Renew now**, **Stop this run**, and **Disable hosting**, and retains the last 10 renewal records.

![Renew hosting dialog: enabled account, credential expiry, pinned exit and fingerprint, and renewal history](assets/screenshot-hosting-en.png)

### Everyday polish

- **Offline brand icons:** Ships the magpie provider icon set locally (`assets/icons/`, indexed in `assets/icons/index.json`, attributions in `assets/icons/NOTICES.md`), tinted automatically for light/dark themes with zero network requests.
- **4 languages & live theme sync:** Native English, 简体中文, 繁體中文, and 日本語 — language and theme sync live with magpie.

<a id="cli"></a>

## Agent & command-line interface (CLI / HTTP API)

**Prefer automation over clicking?** Clean Login ships a zero-dependency CLI client and a compact HTTP API built for AI agents and scripts. The CLI only requires global `fetch` (Bun or Node 18+), starts in milliseconds, and never loads Camoufox modules.

### 3-step Agent quickstart

1. **Locate the CLI (zero extra installs):**
   - Installed via magpie (recommended): `bun ~/.config/magpie/plugins/node_modules/@gruu6y/page-clean-login/bin/clean-login.mjs <cmd>` (or `node`)
   - Inside this repository: `bun bin/clean-login.mjs <cmd>`
   - If installed globally from npm: `clean-login <cmd>`
2. **Fetch full state in one call:** Run `agent` (`GET /api/agent`) to retrieve version, port, command catalog, browser readiness, active jobs, provider cards, proxy list (passwords omitted), account list, and recovery notices (`recovered`) in compact JSON without 4-language UI strings.
3. **Skip polling loops with `--wait` / `?wait=<ms>`:** Every async job supports blocking until settled or waiting for caller input (`waiting-code` / `paste-required`). Bare CLI `--wait` defaults to `60000` ms; HTTP `?wait=<ms>` is capped at `120000` ms by the server.

### Connection, auth, and output contract

- **Default URL:** `http://127.0.0.1:3492` (override via `--port` / `--url` or `CLEAN_LOGIN_PORT` / `CLEAN_LOGIN_URL`).
- **Automatic loopback auth:** Against localhost, the CLI reads the per-process token from `<meta name="clean-login-token">` on `/` and sends `x-clean-login-token`, **never printing the token**. Against non-loopback remotes (e.g., `magpie web`), auto-fetch is refused and you must pass `--token <HEX>` explicitly.
- **Machine-readable output:** Success prints valid JSON to stdout (`--raw` for compact single-line JSON) with exit code `0`; errors print single-line JSON `{"error":"...","status":...,"message":"..."}` to stderr with exit code `1` (note: `proxy test` also exits `1` when `ok: false`).
- **Account argument shape:** Per-account commands (`accounts exit` / `note` / `delete`, `check`) take `<provider> <key>` as **two separate positional arguments** (the CLI URL-encodes them so `#` inside keys is preserved). Only `accounts import run --only <provider>#<recordId>` uses the single composite spelling (repeatable).

### Complete CLI command reference

| Group | Command | Description |
| --- | --- | --- |
| **Overview & health** | `agent` / `status` / `providers` | Compact service snapshot (`GET /api/agent`) / health check / provider cards |
| **Proxy management** | `proxies` | List all proxies (passwords omitted, exposes `hasPassword` only) |
| | `proxies add <name> <type> <host> <port> [--user U] [--pass P]` | Add a proxy (`http\|https\|socks5`; port is positional to avoid clashing with server `--port`) |
| | `proxies import [--file PATH \| <text>] [--type T] [--prefix P]` | Bulk-import proxies from text or UTF-8 file with automatic dedup |
| | `proxies update <proxyId> [--name N] [--type T] [--host H] [--exit-port P] [--user U] [--pass P] [--clear-password]` | Update a proxy (connection edits clear stale probes & re-sync bound accounts; use `--exit-port`) |
| | `proxies delete <proxyId>` / `proxies targets` | Delete a proxy / list provider latency probe targets |
| **Proxy probes** | `proxy test <proxyId> [--provider ID]` | Probe proxy reachability (optionally targeting a provider's API host) |
| | `proxy score <proxyId> [--wait ms]` / `score status [--wait ms]` / `score cancel` | Start, inspect, or cancel Claude trust scoring |
| **Account management** | `accounts` | List known accounts and sign-in states |
| | `accounts import plan` / `accounts import run [--only <provider>#<recordId>]...` | Preview or run import of existing magpie accounts (plan & run share one implementation) |
| | `accounts exit <provider> <key> [--mode inherit\|direct\|custom] [--proxy ID]` | Inspect or update an account's effective exit |
| | `accounts note <provider> <key> <text>` / `accounts delete <provider> <key>` | Set note / remove a signed-out account |
| | `accounts prune` / `accounts hosting` | Prune orphan directories without credentials / inspect renew-hosting policies & active run |
| **Sign-in flows** | `signin start --provider ID [--proxy ID] [--method LABEL] [--input k=v]... [--single] [--wait ms]` | Start an isolated plugin-provider sign-in |
| | `signin status [--wait ms]` / `signin code <code>` / `signin cancel` | Inspect status / submit one-time code / cancel sign-in |
| | `native start --provider ID [--wait ms]` / `native status [--wait ms]` / `native paste <text>` / `native cancel` | Drive a magpie built-in provider sign-in (paste callback URL or code) |
| **Browser & checks** | `env [--wait ms]` / `env prepare [--wait ms]` / `env cancel` | Check, start, or cancel one-time login browser download |
| | `check <provider> <key> [--wait ms]` | Inspect an account's `who.1ms.dog` identity check job |
| **Market & report** | `market status` / `market install <package>` | Check market install job / install a provider plugin from magpie's catalog |
| | `report --provider ID [--note TEXT] [--language LANG]` | Generate a scrubbed issue report body for a provider |

### Common CLI examples

```sh
# 1) Read full state in one call (recommended first command for agents)
bun bin/clean-login.mjs agent

# 2) Prepare the login browser and wait until ready
bun bin/clean-login.mjs env prepare --wait

# 3) Manage proxies: add, bulk import, update, test, and trust score
bun bin/clean-login.mjs proxies add hk-home-1 http 127.0.0.1 7102
bun bin/clean-login.mjs proxies import --file ./exits.txt --type http --prefix HK
bun bin/clean-login.mjs proxies update <proxyId> --host 10.0.0.2 --exit-port 1080
bun bin/clean-login.mjs proxy test <proxyId> --provider workbuddy
bun bin/clean-login.mjs proxy score <proxyId> --wait

# 4) Import accounts, sign in, submit code, set exit & note
bun bin/clean-login.mjs accounts import plan
bun bin/clean-login.mjs accounts import run --only <provider>#<recordId>
bun bin/clean-login.mjs signin start --provider workbuddy --proxy hk-home-1 --wait
bun bin/clean-login.mjs signin code 123456
bun bin/clean-login.mjs accounts exit <provider> <key> --mode custom --proxy <proxyId>
bun bin/clean-login.mjs accounts note <provider> <key> backup
bun bin/clean-login.mjs accounts delete <provider> <key>

# 5) Maintenance and job control
bun bin/clean-login.mjs accounts prune
bun bin/clean-login.mjs accounts hosting
bun bin/clean-login.mjs env cancel
bun bin/clean-login.mjs score cancel
```

### Direct HTTP API (for shell-less Agents)

All `/api/*` routes require `x-clean-login-token: <token>`:

- **Compact overview:** `GET /api/agent`, `GET /api/health`
- **Async routes supporting `?wait=<ms>` blocking:**
  - `GET /api/signin?wait=<ms>` (`POST /api/signin`, `POST /api/signin/code`, `POST /api/signin/cancel`)
  - `GET /api/native-signin?wait=<ms>` (`POST /api/native-signin`, `POST /api/native-signin/paste`, `POST /api/native-signin/cancel`)
  - `GET /api/proxy-score?wait=<ms>` (`POST /api/proxies/:id/score`, `POST /api/proxy-score/cancel`)
  - `GET /api/environment/job?wait=<ms>` (`POST /api/environment/prepare`, `POST /api/environment/cancel`)
  - `GET /api/accounts/:provider/:key/check?wait=<ms>` (`POST /api/accounts/:provider/:key/check`, `POST .../check/cancel`)
- **Other read/write routes:** `/api/proxies` (plus `/api/proxies/bulk`, `/api/proxies/:id/test`), `/api/accounts` (plus `/import/plan`, `/import`, `/prune`, `/hosting`, `/:provider/:key/exit`, `/:provider/:key/hosting`), `/api/market/install`, `/api/report`.
- **Concurrency guardrail:** Only one sign-in / check / renewal job may run at a time; conflicts return `409`. Run `bun bin/clean-login.mjs help` for full CLI help.

<a id="troubleshooting"></a>

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| A provider card has no **Add account** button | The card states why: catalog items must be installed in magpie first; installed plugins must expose a drivable sign-in flow. |
| Login browser says *Not installed* / download fails | First setup downloads a platform slim archive (153–176 MB: Windows x64 ~176 MB, macOS x64 ~162 MB, macOS arm64 ~154 MB, Linux x64 ~159 MB, Linux arm64 ~153 MB) verified by sha256. Ensure ~1 GB free disk space and network connectivity, then retry. |
| Sign-in fails with `no_url` or `method_input_required` | That sign-in method requires fields first (phone number, site URL, or API key). Fill them in and retry; if it still fails, click **Report a problem** on the card. |
| Selected SOCKS5 proxy, notified plugin requests bypass it | Runtime `fetch` only supports HTTP/HTTPS proxies; SOCKS5 covers the browser window only. Use an HTTP/HTTPS proxy when both legs must share the exact same exit. |
| Proxy test fails | Tests connect directly through the proxy and never fall back to direct. Check host, port, credentials, and whether that exit can reach the target host. |
| Latency shows a leading `~` | Only the TLS handshake finished without an HTTP response (often a WAF block) — not a full request latency. Consider trying another exit. |
| A signed-in account looks like a new machine / want a genuinely new one | An ordinary sign-in again **reuses the old fingerprint**; verify the pinned ID on **Accounts**. To deliberately switch to a brand-new machine, click **Renew fingerprint** on the signed-in row to draw a new fingerprint and clear the old profile while keeping the account and credentials. |
| Identity check returned C or D | That exit looks dirty — pick another proxy exit and sign in again. |
| Renew hosting auto-paused | Open **Renew hosting** on that row to inspect the reason (CAPTCHA / device code / OTP required, account identity mismatch, or repeated post-expiry failures), resolve it, and re-enable manually. |
| Anything else | Open an [issue](https://github.com/Gruu6y/magpie-clean-login/issues) with expected behavior, actual result, affected provider/proxy, and scrubbed screenshots. **Never paste real tokens, cookies, or proxy passwords.** |

<a id="privacy"></a>

## Privacy, data paths, and environment variables

- **Zero telemetry, no cloud account:** Aside from actions you explicitly initiate (proxy tests, trust scores, identity checks, browser download, provider sign-ins), Clean Login sends no outbound requests.
- **Where data lives:**
  - Proxies, account ledger, pinned fingerprints, isolated browser profiles, and renewal policies (`renew-hosting.json` — toggle/timestamps/results only, no credentials) live under `~/.config/magpie/magpie-clean-login/`.
  - Market catalog is read from `~/.cache/magpie/`; per-account exits sync to `~/.config/magpie/providers.json`.
  - Login browser and fingerprint model cache: Windows `%LOCALAPPDATA%/magpie-clean-login/camoufox` · macOS `~/Library/Caches/magpie-clean-login/camoufox` · Linux `$XDG_CACHE_HOME/magpie-clean-login/camoufox`.
- **Credential safety:** Proxy passwords stay local and are never returned to the UI or written to logs; a per-process random page token gates all API routes, and the page only renders inside magpie's sandboxed frame.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `MAGPIE_CONFIG_DIR` | Override magpie config root (default `~/.config/magpie`) |
| `MAGPIE_CLEAN_LOGIN_DATA` | Override Clean Login data directory (default `<MAGPIE_CONFIG_DIR>/magpie-clean-login`) |
| `MAGPIE_CACHE_DIR` | Override magpie market cache directory (default `~/.cache/magpie`) |
| `MAGPIE_CLEAN_LOGIN_BROWSER_DIR` | Override login browser and `fpgen` model cache directory |
| `MAGPIE_CLEAN_LOGIN_BROWSER_URL` / `MAGPIE_CLEAN_LOGIN_BROWSER_SHA256` | Override login browser download URL and sha256 checksum (for private mirrors) |
| `CAMOUFOX_EXECUTABLE_PATH` | Point to an existing Camoufox executable |
| `MAGPIE_CLEAN_LOGIN_DISPLAY` | Explicit X11 display (e.g., `:99`) on headless Linux when `DISPLAY` / `WAYLAND_DISPLAY` is unset |
| `MAGPIE_CLEAN_LOGIN_FONTCONFIG` | Linux fontconfig override: `system` (`/etc/fonts/fonts.conf`) or a custom `fonts.conf` path (never overrides existing `FONTCONFIG_FILE`) |
| `CLEAN_LOGIN_URL` / `CLEAN_LOGIN_PORT` | Override CLI target server URL / port (default `http://127.0.0.1:3492`) |
| `MAGPIE_CLEAN_LOGIN_IP_ENDPOINT` | Override general exit-check endpoint |
| `MAGPIE_CLEAN_LOGIN_PROXY_TIMEOUT_MS` / `MAGPIE_CLEAN_LOGIN_SCORE_TIMEOUT_MS` / `MAGPIE_CLEAN_LOGIN_CHECK_TIMEOUT_MS` | Override timeouts (ms) for proxy test / trust score / identity check |

<a id="contributing"></a>

## Contributing

Pull requests are welcome. The test suite is the contract: run the full `bun test` before committing, and include tests with every feature or fix. When changing `lib/`, `ui/`, `page/`, or `index.mjs`, **do not edit `version` in `package.json` yourself** — versions are assigned centrally at merge time and tagged to publish automatically to npm (`node scripts/check-version-bump.mjs` blocks downgrades and duplicate versions). Read [AGENTS.md](AGENTS.md) and [docs/releasing.md](docs/releasing.md) before starting.

<a id="license"></a>

## License

[MIT](LICENSE) © 2026 Gruu6y · [npm package](https://www.npmjs.com/package/@gruu6y/page-clean-login) · [Tags / Releases](https://github.com/Gruu6y/magpie-clean-login/tags) · [Issue reporting](docs/reporting.md) · [CI](https://github.com/Gruu6y/magpie-clean-login/actions/workflows/ci.yml)
