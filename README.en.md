# Magpie Clean Login · 干净登录

[简体中文](README.md) · **English**

[![tag](https://img.shields.io/github/v/tag/Gruu6y/magpie-clean-login?style=flat-square)](https://github.com/Gruu6y/magpie-clean-login/tags)
[![ci](https://github.com/Gruu6y/magpie-clean-login/actions/workflows/ci.yml/badge.svg)](https://github.com/Gruu6y/magpie-clean-login/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

**Magpie Clean Login (CL · 干净登录) is an unofficial [magpie](https://usemagpie.ai) plugin for provider sign-ins: one page to manage proxy exits, where every account signs in through its own isolated browser identity and its own chosen proxy. The canonical repository is [github.com/Gruu6y/magpie-clean-login](https://github.com/Gruu6y/magpie-clean-login).**

![The Providers tab: the three-tab header, search, one-time browser setup and the first provider cards](assets/screenshot-providers.png)

> **Unofficial plugin.** Clean Login is built and maintained here, at [Gruu6y/magpie-clean-login](https://github.com/Gruu6y/magpie-clean-login). It is **not** published by `magpie-community`, and nobody has reviewed it but you. Read the code, open an issue, send a pull request — all three are welcome.

> **中文读者：** 完整的简体中文文档在 [README.md](README.md)，这一份是英文版。

## Contents

- [Why](#why)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [The three tabs](#the-three-tabs)
- [Features](#features)
- [Command line and agents](#command-line-and-agents)
- [Troubleshooting](#troubleshooting)
- [Privacy and where your data lives](#privacy-and-where-your-data-lives)
- [Contributing](#contributing)
- [License](#license)

## Why

- **One account, one machine.** Profiles, cookies and fingerprints are never shared, so two accounts of the same provider never look like the same browser. Signing out keeps the identity; signing back in reuses it.
- **The exit you picked really is the exit.** The login browser *and* the plugin's own requests both go through the chosen proxy. Choosing **Direct** means direct — it does not silently fall back to magpie's global proxy.
- **No provider list to maintain.** Clean Login reads the provider plugins you already installed and the magpie market catalogue, and offers an entry wherever a plugin exposes a sign-in. Add a provider to magpie and it shows up here.

## Requirements

| | |
| --- | --- |
| Host | [magpie](https://usemagpie.ai), with its Plugins panel |
| OS | **Windows x64** — the bundled login browser is a Windows-only Camoufox build |
| Runtime | Bun **≥ 1.4.2** |
| Disk | ≈ 170 MB download, ≈ 616 MB on disk, ≈ 1.02 GB free to install — once |
| Network | Only for the calls you start: proxy tests, the trust-score and identity-check pages, the runtime download, and the provider's own sign-in |

Other platforms are not supported yet; platform requests belong in the [issue tracker](https://github.com/Gruu6y/magpie-clean-login/issues).

## Install

1. Open magpie → **Plugins** → **Discover** → **Unofficial**.
2. Find **Clean Login** by **Gruu6y** and press **Install**. If the list has not caught up yet, press **Retry** — magpie caches what GitHub told it.
3. Open **Clean Login** from the sidebar.

Every version is tagged (`v0.1.x`) in this repository; the [tag list](https://github.com/Gruu6y/magpie-clean-login/tags) is the version history.

## Quick start

The first time you sign in, Clean Login downloads its own browser runtime — about **170 MB**, once, verified by a pinned sha256 digest. Everything after that runs offline from your machine.

1. **Proxy IPs** → add the exits you want to log in through.
2. Press **Test** on each one and check the exit IP and region look right. Add a trust score if you want a second opinion.
3. **Providers** → pick a provider → choose its proxy → **Add account**.
4. If the provider's sign-in opens a browser, a separate browser window appears: sign in there as usual; it finishes by itself and the account appears in magpie. Close the window to cancel instead.
5. If the provider asks for a value first (a phone number, for instance), fill it in the dialog and press **Start sign-in**. When the plugin sends a one-time code, type it in the same dialog and press **Submit code**.

> A provider needs a sign-in magpie can drive. A card without **Add account** has no runnable sign-in method from an installed plugin — a market offer that is not installed yet, for example — and the card says why.

## The three tabs

**Proxy IPs** — test an exit through a real connection, read the exit IP, region and latency, then filter by region, latency and the tags in the name (家宽 / 静态). No direct-connection fallback: if a test fails, you see why. The measurement target can be the general exit check or a specific provider, measured straight to its API host.

![The Proxy IPs tab: region and latency filters, tested exits and per-row actions](assets/screenshot-proxies.png)

**Accounts** — every account, its pinned fingerprint, the last login, and the verdict from the third-party identity check. The A/B/C/D verdict is from `who.1ms.dog`; it is not a provider risk-control conclusion and not a fingerprint score of our own.

![The Accounts tab: verdict key, pinned fingerprints, last login and status](assets/screenshot-accounts.png)

> Screenshots above were rendered from a local Clean Login instance using **synthetic accounts** and documentation-range IP addresses (`203.0.113.x`, `198.51.100.x`, `192.0.2.x`). No real credentials appear in this repository.

## Features

**Sign-ins**

- Reads the provider plugins you have installed and offers **Add account** wherever one exposes a runnable sign-in — a login page, a form, or a one-time code. One plugin exposing several providers gets one card per provider.
- Providers that ship with magpie itself have no plugin to read, so the entry runs magpie's own sign-in instead. With magpie's sign-in pages off, that sign-in prints its link and Clean Login opens it for you.
- When a provider offers several routes — a per-site login, a team plan, reusing the desktop session, pasting a key — you choose, and each route is labelled with its kind before you start.
- Values the plugin asks for are collected in the dialog; a code the plugin sends comes back to the same dialog. No browser window opens when there is nothing to open.
- **Report a problem** on a card opens a GitHub issue with the title and body already written — you only press **Create** ([how it works](docs/reporting.md)).

**Exits and identity**

- Choose the proxy in the add-account dialog and the whole sign-in uses it: the browser window, and the plugin's requests to mint the link and exchange the code. A **SOCKS** exit carries the browser window but not the plugin's own requests — the runtime's proxy support speaks HTTP/HTTPS only.
- The exit picker in that dialog shows each exit's measured latency and puts the ones **this provider has not used yet** first, with the used ones last.
- Test an exit to see its real IP, region and latency. Optionally fetch the Claude trust score (`ip.net.coffee/claude`, 0–100) through that very proxy and keep it on the row. With a provider selected as the target, the number is the round trip to that provider's API host; if only the TLS handshake completed and no HTTP response arrived, the number is labelled as a handshake time instead of passing for a request latency.
- Filter the proxy list by region, latency range and name tags; filter accounts by status; search providers by name, id or the words on their cards. A match inside the collapsed section opens that section for you.
- Signing an account out does not throw its browser identity away — signing back in reuses the same one.

**Everyday use**

- Each provider card carries the brand mark **magpie** itself ships, recoloured to follow the theme. Nothing is fetched to draw them: the set is copied into `assets/icons/`, with what it was taken from written in `assets/icons/index.json` and the ownership note in `assets/icons/NOTICES.md`.
- **Four languages**: English, 简体中文, 繁體中文, 日本語, following magpie's language setting.
- Light and dark follow magpie's theme setting, and switching it while the page is open takes effect immediately.
- Everything stays on this computer: no account, no telemetry, no request out for a logo. Stored proxy passwords are never shown to the page and never written to a log.

## Command line and agents

The page is built for a person with a mouse. A script or an agent can drive the same service without the UI, using the bundled CLI:

```sh
bun bin/clean-login.mjs agent       # compact digest of the whole service, as JSON
bun bin/clean-login.mjs providers   # just the provider cards
bun bin/clean-login.mjs proxies     # just the exits, without credentials
bun bin/clean-login.mjs accounts    # just the accounts
```

The CLI finds the service at `127.0.0.1:3492` (override with `--port` or `--url`), reads the per-process page token from the page it serves, and never prints that token. It has no dependencies beyond the runtime's `fetch`, so it starts in milliseconds and does not load the browser modules.

Two things keep a program from having to poll:

- **`GET /api/agent`** returns one compact, self-describing digest: the version, the service port, the command catalog, and the merged provider cards, proxies, accounts and running job states. It does not carry the four-language descriptions, notices or capability reasons the page needs, and never carries a password.
- **`?wait=<ms>`** on the async status routes (`/api/signin`, `/api/native-signin`, `/api/proxy-score`, `/api/environment/job`, `/api/accounts/:provider/:key/check`) blocks inside the service until the job settles or the bound elapses. One request replaces the browser's poll loop. A state that needs the caller to act — a one-time code, a pasted value — ends the wait immediately instead of holding the connection open.

```sh
bun bin/clean-login.mjs signin start --provider workbuddy --proxy hk-home-1 --wait
bun bin/clean-login.mjs signin code 123456
bun bin/clean-login.mjs proxy score hk-home-1 --wait
```

Run `bun bin/clean-login.mjs help` for the full command list. A remote service (`magpie web`) has no loopback page to read, so pass `--token` there explicitly; the token is the one embedded in the page the service serves.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| A provider card has no **Add account** | The card says why. Market offers need their plugin installed in magpie; plugin-only providers need a plugin that exposes a browser sign-in. |
| The login browser says *not installed* / download failed | The first run fetches a ≈170 MB Windows x64 archive. Check disk space and network, then retry from the Providers tab. The archive is sha256-verified before unpacking. |
| A sign-in failed with `no_url` or `method_input_required` | The plugin asked for a value (a phone number, a site, a key) that the dialog did not collect. Fill the field and retry; if it keeps failing, use **Report a problem** on the card. |
| Proxy test fails | The test makes a real connection through that exit and never falls back to a direct one. Check the host, port, credentials and whether the exit allows the target. |
| A signed-in account looks like a new machine | Check its pinned fingerprint on **Accounts**. Signing back in reuses the same identity; deleting the account data removes it. |
| Something else | Open an [issue](https://github.com/Gruu6y/magpie-clean-login/issues) with what you expected, what happened, and which provider or proxy was involved. A screenshot of the message is worth a lot. Please never paste real tokens or proxy passwords into an issue. |

## Privacy and where your data lives

- There is no telemetry and no account. The only network calls are the ones you start: the proxy test, the trust-score page, the identity-check page, the runtime download, and the provider's own sign-in.
- Proxies, accounts, fingerprints and browser profiles live in `~/.config/magpie/magpie-clean-login/` (override with `MAGPIE_CLEAN_LOGIN_DATA`; the config root itself with `MAGPIE_CONFIG_DIR`). The market catalogue is read from `~/.cache/magpie/` (`MAGPIE_CACHE_DIR`).
- The login browser is unpacked into `%LOCALAPPDATA%/magpie-clean-login/camoufox` on Windows (`MAGPIE_CLEAN_LOGIN_BROWSER_DIR`).
- Stored proxy passwords never reach the page and are never written to a log. The page token is per-process and lives in the served page.

## Contributing

Pull requests are welcome. The suite is the contract: `bun test` runs everything, and a change without a test is a change nobody can trust later. `node scripts/check-version-bump.mjs` decides whether a change to `lib/`, `ui/`, `page/` or `index.mjs` needs a version bump; docs-only changes do not. Read [AGENTS.md](AGENTS.md) before you start.

## License

[MIT](LICENSE) © 2026 Gruu6y. [Tag list / version history](https://github.com/Gruu6y/magpie-clean-login/tags) · [Reporting a problem](docs/reporting.md) · [CI](https://github.com/Gruu6y/magpie-clean-login/actions/workflows/ci.yml)
