# everyone-content

<img src="frontend/public/brand/mascot.png" alt="everyone-content mascot" width="96" />

**A local-first workbench for multi-account content operations**: discover topic material through the Douyin Index, ground decisions in per-account profiles, and keep the whole collect → select → review loop on your own machine.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPLv3-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A524-green)
![Local-first](https://img.shields.io/badge/data-local--first-orange)

[简体中文](README.md) | English

## What problem it solves

People running multiple content accounts face three scattered things: topic choices come from scrolling feeds, account positioning lives in their head, and evidence never lines up with data. everyone-content pulls them into one local system:

- **Collection with facts**: per-account keywords and filter rules pull 30-day topics, keyword videos, and creator boards from the Douyin Index. Raw responses are archived compressed; unknown metrics stay `null` — nothing is fabricated.
- **Decisions with a profile**: each account maintains a seven-part profile (positioning, persona, audience, conversion, strategy, format, boundaries), versioned in a local Git ref, checked item by item during topic review; review checks fit, never predicts traffic.

## How it works

Two halves: a **local workbench** (Node.js API + React UI + SQLite) for configuration, collection, and data; and an **agent conversation** (Codex, Claude Code, or any assistant that can read project instructions and local skills) for profiles and topic review.

```text
account keywords, index authorization, filter rules
  → planner: due tasks
  → runner: leases, rate limits, budgets, requests
  → raw responses, parse cache, works, authors, topics, metric observations
  → SQLite → workbench
```

The agent reads a one-line initialization state at the top of `AGENTS.md` and routes to one of two business skills (initialization / topic review) without loading the whole flow every time.

Key design:

- **SQLite is the single source of truth.** Accounts, subscriptions, authorizations, rules, and results are isolated per `account_id`; every API request verifies ownership.
- **Profiles are versioned via Git refs** (`refs/everyone-content/profiles/<account_id>`). Publishing never touches your branch or staging area; restoring a version creates a new commit.
- **Collection is a deterministic program.** The agent never writes its own scraper; budgets, dedup, and storage live in planner/runner/store.
- **Unknown stays `null`.** Source valid-dates, statistics windows, and observation times are stored separately.

## Quick start

Requires **Node.js 24+**, **Git**, and an agent that can read project instructions and local skills. macOS / Linux; index QR login needs a local desktop.

```sh
git clone <repository-url>
cd everyone-content
npm ci
npm --prefix frontend ci
npm run build:web
npm run web
```

Open http://127.0.0.1:8788 — a blank default account is created on first start. Then tell your agent:

> I'm using this for the first time, walk me through setup

## Core flow

1. **Initialize the account** — fill in the seven profile parts; topic review unlocks after the profile is published.
2. **Connect the Douyin Index** — scan the QR code in the dedicated official login window; the session is stored privately (0700/0600), no cookie export needed.
3. **Configure collection** — keywords and filter rules; manual runs or a daily Beijing-time schedule. The daily request cap is shared across accounts, max 10 per tick.
4. **Pick topics yourself** — browse selected videos in the workbench, watch them on the platform, decide on your own.
5. **Agent review** — submit a **title, target audience, one-line value**; the agent checks account fit, consistency, and specificity.

## Privacy & data boundaries

- Everything stays local: SQLite database, runtime data, profile Git repository. No third-party services.
- Sessions and authorization files are secrets (0600), never committed, never echoed to the frontend.
- **Disclaimer**: this project connects to the Douyin Index through the official login window for personal research on your own accounts. You are responsible for complying with platform terms and local law; keep the built-in rate limits enabled.

## Commands

```sh
npm run web                             # start the workbench
npm run collect -- --account=1          # manual collection
npm run collection:plan -- --account=1  # plan only, no requests
npm test                                # regression suite
npm run typecheck                       # backend types
npm run build:web                       # frontend build
```

Docs (Chinese): [collection](docs/COLLECTION.md) · [accounts & profiles](docs/MULTI_ACCOUNT.md) · [architecture](docs/ARCHITECTURE.md) · [decisions](docs/decisions.md)

## Contributing

Run checks matching your change: `npm test`, `npm run typecheck`, `npm run build:web`. Skills live only in `skills/`; `.agents/skills/` registers them via relative links. Keep tests green before opening a PR.

## License

[AGPL-3.0](LICENSE)
