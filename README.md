# 📊 AI Pulse

Copilot coding agent PR analytics dashboard. Collects PR data from configurable GitHub repos and visualizes merge rates, cost scores, autonomous completion rates, and abandon patterns.

## Quick Start

1. Copy `.env.example` to `.env` and configure your repos, date range, and labels
2. `npm install`
3. `npm run fetch` — collects PR data from GitHub
4. `npm run dev` — opens the dashboard locally

## Configuration

See `.env.example` for all configuration options.

## Architecture

- `src/` — TypeScript data collection pipeline
- `docs/` — Static HTML dashboard (GitHub Pages)
- `data/` — Generated JSON output (gitignored)

## Live Dashboard

🚧 Coming soon — will be deployed to GitHub Pages.
