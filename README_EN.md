# everyone-content

<img src="frontend/public/brand/mascot.png" alt="everyone-content mascot" width="96" />

**A local-first workbench for multi-account content operations**: discover topic material through the Douyin Index, ground decisions in per-account profiles, and complete the whole collect → select → review → write process faster and with higher quality.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPLv3-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A524-green)
![Local-first](https://img.shields.io/badge/data-local--first-orange)

[简体中文](README.md) | English

## What problem it solves

People running multiple content accounts face three scattered things: topic choices come from scrolling feeds, account positioning lives in their head, and evidence never lines up with data. everyone-content pulls them into one local system:

- **Collection with facts**: per-account keywords and filter rules pull topics, keyword videos, and creator boards from the Douyin Index, driving topic choices with real data instead of guesswork and vibes.
- **Decisions with a profile**: each account maintains a seven-part profile (positioning, persona, audience, conversion, strategy, format, boundaries), checked item by item during topic review to keep every topic aligned with the account's positioning and goals.

## How it works

This project has two halves:
a **local workbench** for configuration, collection, and data display;
an **agent conversation** for profiles and topic review.

They are connected through local state:

```text
account keywords, index authorization, filter rules
  → planner: due tasks
  → runner: leases, rate limits, budgets, requests
  → raw responses, parse cache, works, authors, topics, metric observations
  → SQLite → workbench
```

Key design:

- **SQLite is the single source of truth.** Accounts, subscriptions, authorizations, rules, and results are isolated per `account_id`; every API request verifies ownership.
- **Profiles are versioned via Git refs** (`refs/everyone-content/profiles/<account_id>`). Publishing never touches your branch or staging area; restoring a version creates a new commit.
- **Collection is a deterministic program.** The agent never writes its own scraper; budgets, dedup, and storage live in planner/runner/store.
- **Unknown stays `null`.** Source valid-dates, statistics windows, and observation times are stored separately.

## Quick start

Requires **Node.js 24+**, **Git**, and an agent that can read project instructions and local skills. macOS / Linux are fully supported; Windows is untested — the workbench runs, but CLI collection depends on `sh` (use Git Bash, or run `node collector/run.ts` directly), and skill discovery needs symlinks enabled (Developer Mode + `git config core.symlinks true`). Index QR login needs a local desktop.

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

1. **Initialize the account** — complete the initial account profile; topic review unlocks after it is published. You can also do this in Settings → Account Profile.
2. **Connect the Douyin Index** — scan the QR code in the dedicated official login window; the session is stored privately (0700/0600), no cookie export needed.
3. **Configure collection** — add keywords in Settings → Keywords, then set collection parameters and filter rules in Settings → Collection; run manually from Collection → Discovery, or schedule a daily Beijing-time run. The daily request cap is shared across accounts, max 10 per tick.
4. **Pick topics yourself** — browse selected videos in the workbench, watch them on the platform, decide on your own.
5. **Agent review** — submit a **title, target audience, one-line value**; the agent checks account fit, consistency, and specificity.
6. **Write on demand** — before any drafting or editing you must provide 3 of your own video scripts (300+ characters in total); writing preferences only supplement them (templates: [originals](skills/personal-writing/assets/user-original.md), [preferences](skills/personal-writing/assets/writing-preferences.md)). The agent works only from your own materials — no generic templates, and no sample drafts when materials are missing. Confirmed preferences and originals are registered under local `runtime/writing/` and accumulate across sessions; reference text is capped (≤20 originals and ≤20,000 characters in total, preferences ≤5,000 characters) so it never grows unbounded.

"Published" records actual release links; metrics appear only when the index has collected the same work, and stay unknown otherwise.

## Multi-account

An account is an independent local content-operations space, not a Douyin login; a blank default account is created on first start. Keywords, index authorization, filter rules, profiles, and collection results are maintained per account — a new account starts blank and inherits nothing from other accounts. Authorization scopes are `account:<id>`; the same keyword never borrows another account's authorization or results. Archiving keeps the history and blocks writes and scheduled collection; restoring resumes normal use.

See [accounts & profiles](docs/MULTI_ACCOUNT.md) for details.

## Privacy & data boundaries

- Everything stays local: SQLite database, runtime data, profile Git repository. No third-party services.
- Sessions and authorization files are secrets (0600), never committed, never echoed to the frontend.
- Writing preferences and originals are stored per account under local `runtime/writing/` (0600), with count and size caps.
- Reviews and drafts are delivered in conversation; the workbench has no registration entry.
- UI times are interpreted as Beijing time; the database stores UTC.
- **Usage boundary**: this project is for data collection and inspiration only — plagiarism and imitation are rejected. Collected topics, videos, and creator data serve only as factual references for topic selection; keep your own work independent and original.
- **Disclaimer**: this project connects to the Douyin Index through the official login window for personal research on your own accounts. You are responsible for complying with platform terms and local law; keep the built-in rate limits enabled.

## Contributing

Run checks matching your change: `npm test`, `npm run typecheck`, `npm run build:web`. Skills live only in `skills/`; `.agents/skills/` registers them via relative links. Keep tests green before opening a PR.

## License

[AGPL-3.0](LICENSE)
