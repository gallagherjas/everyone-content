<div align="center">

# everyone-content

<img src="frontend/public/brand/mascot.png?v=2" alt="everyone-content mascot" width="96" />

**A local-first workbench for multi-account content operations**: discover topic material through the Douyin Index, ground decisions in per-account profiles, and complete the whole collect → select → review → write process faster and with higher quality.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPLv3-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-green)
![Local-first](https://img.shields.io/badge/data-local--first-orange)
[![CI](https://github.com/gallagherjas/everyone-content/actions/workflows/ci.yml/badge.svg)](https://github.com/gallagherjas/everyone-content/actions/workflows/ci.yml)

[简体中文](README.md) | English

</div>


## What problem it solves

People running multiple content accounts face three scattered things: topic choices come from scrolling feeds, account positioning lives in their head, and evidence never lines up with data. everyone-content pulls them into one local system:

- **Collection with facts**: per-account keywords and exclusion words pull topics, videos, and creator boards from the Douyin Index, and tracked bloggers add their works and daily stats, driving topic choices with real data instead of guesswork and vibes.
- **Decisions with a profile**: each account maintains a seven-part profile (positioning, persona, audience, conversion, strategy, format, boundaries), checked item by item during topic review to keep every topic aligned with the account's positioning and goals.
- **Writing in your style**: start by collecting at least 3 of your own scripts (300+ characters in total); drafts are generated from your writing preferences and keep improving as more of your own writing comes in. The gate exists for better drafts — so the style keeps getting closer to yours and stays free of the AI flavor.

Tip: the agent never picks topics for you, because it leans too heavily on historical data and lacks creativity — this project reviews topics, it does not generate them. We also hope you become a genuinely creative person: some ideas may be inspired by others, but never just trust the AI!!

## Quick start

Requires **Node.js 24+**, **Git**, and an agent that can read project instructions and local skills. macOS, Linux, and Windows are supported (CI runs on both platforms); index QR login needs a local desktop.

```sh
git clone https://github.com/gallagherjas/everyone-content.git
cd everyone-content
npm ci
npm --prefix frontend ci
npm run build:web
npm run web
```

Open http://127.0.0.1:8788 and enter a name in the workbench to create an account. If the port is in use, run `WEB_PORT=8789 npm run web`.

Open an agent conversation in the project directory and try either of these requests.

- Start the project and show me how to use it.
- Set up an account, complete its profile, and configure Douyin Index collection.

## Core flow

1. **Set up an account.** Create or select an account, publish its completed profile, connect to the Douyin Index, and save keywords and exclusion words. For an existing account, resume from the missing steps. 
2. **Collect.** Run a round from Collect → Overview, ask the agent to run it for a specific account, or enable a schedule in Collect → Schedule.
3. **Pick topics yourself.** Browse the leaderboard in Index → Videos, watch the videos on the platform, and decide which topics to pursue.
4. **Ask the agent to review a topic.** Once the completed profile is published, submit a **title, target audience, and one-line value**. The agent checks account fit, consistency, and specificity. You can include reference videos.
5. **Write on demand.** Before drafting or editing, provide 3 of your own video scripts with at least 300 characters of body text in total. 

## Multi-account

Each account is an independent local workspace for content operations, with a name you choose. Keywords, index authorization, exclusion words, profiles, and collection results are maintained per account. New accounts start blank.

## Privacy & data boundaries

- Everything stays local: SQLite database, runtime data, profile Git repository. No third-party services.
- Sessions and authorization files are secrets (0600), never committed, never echoed to the frontend.
- Writing preferences and originals are stored per account under local `runtime/writing/` (0600), with count and size caps.
- Reviews and drafts are delivered in conversation; the workbench has no registration entry.
- UI times are interpreted as Beijing time; the database stores UTC.
- **Usage boundary**: this project is for data collection and inspiration only — plagiarism and imitation are rejected. Collected topics, videos, and creator data serve only as factual references for topic selection; keep your own work independent and original.
- **Disclaimer**: this project connects to the Douyin Index through the official login window for personal research on your own accounts. You are responsible for complying with platform terms and local law; keep the built-in rate limits enabled.

## Contributing

Run checks matching your change: `npm test`, `npm run typecheck`, `npm run build:web`. Maintain skill sources in `skills/`. The files in `.agents/skills/` are synchronized copies used for agent discovery, and tests verify that they match.

## License

[AGPL-3.0](LICENSE)
