# 📊 AI Pulse

Copilot coding agent PR analytics dashboard. Collects data from configurable GitHub repositories and visualizes merge rates, cost scores, autonomous completion rates, and abandon patterns via a GitHub Pages dashboard.

Inspired by [timotheeguerin/tsp-copilot-stats](https://github.com/timotheeguerin/tsp-copilot-stats).

## Quick Start

1. Clone and install:
   ```bash
   git clone https://github.com/ronniegeraghty/ai-pulse.git
   cd ai-pulse
   npm install
   ```

2. Configure: Copy `.env.example` to `.env` and set your repos and date range:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. Collect data:
   ```bash
   npm run fetch
   ```

4. View dashboard locally:
   ```bash
   npm run dev
   # Opens at http://localhost:3000
   ```

## Configuration

All configuration is via environment variables (`.env` file):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AI_PULSE_REPOS` | ✅ | — | Comma-separated repos (`owner/repo` format) |
| `AI_PULSE_START_DATE` | ✅ | — | Start date (YYYY-MM-DD, inclusive, by PR created_at) |
| `AI_PULSE_END_DATE` | ✅ | — | End date (YYYY-MM-DD, inclusive) |
| `AI_PULSE_LABELS` | ❌ | `""` (all PRs) | Comma-separated label filter |
| `AI_PULSE_AI_LOGINS` | ❌ | `copilot,copilot[bot]` | GitHub logins considered "AI" |
| `AI_PULSE_INACTIVE_DAYS` | ❌ | `14` | Days of inactivity = "abandoned" for open PRs |
| `GITHUB_TOKEN` | ❌ | `gh auth token` | GitHub token (falls back to gh CLI) |

## Dashboard

The dashboard shows:

### Summary Cards
- **Total Copilot PRs** — count of PRs matching filters
- **Merge Rate** — merged / (merged + abandoned)
- **Avg Time to Merge** — days from PR creation to merge (includes draft time)
- **Avg Comments per PR** — mean issue thread comments
- **Fully Autonomous** — % of merged PRs with no human code pushes
- **Avg Cost Score** — mean cost score across all PRs

### Charts
1. **Merged vs Abandoned** (weekly, stacked bar)
2. **Avg Comments per PR** (weekly)
3. **Avg Time to Merge** (weekly, days)
4. **Human Intervention** (weekly: Autonomous / Human-assisted / Abandoned)
5. **Cost Score Distribution** (buckets: 0, 0.1-3, 3-6, 6-10, 10+)
6. **Avg Cost Score** (weekly)
7. **PRs by Area** (horizontal, by labels)
8. **Avg Cost Score by Area** (horizontal, by labels)
9. **PRs by Area Over Time** (weekly, stacked by labels)
10. **Why Copilot PRs Get Abandoned** (horizontal, by reason category)

### Filters
- Repository, date range, and area/label filters
- URL parameter support for shareable filter links: `?repos=Azure/azure-sdk-tools&start=2025-01-01&end=2025-06-30&area=bug`

## Metrics

### Cost Score (per PR)
```
CostScore = humanCommits × 3
           + reviewRounds × 2
           + reviewCommentCount × 0.3
           + commentCount × 0.2
           + (abandoned ? 5 : 0)
```
Rounded to 1 decimal. Higher = more human effort required.

### Fully Autonomous
A merged PR is "fully autonomous" if no human-authored commits exist on the PR branch (after filtering inherited commits from before PR creation).

### Abandon Reasons
Abandoned PRs are classified into categories:
- Superseded by another Copilot PR
- Superseded by a human PR
- Agent stuck in WIP loop
- Failed to address review feedback
- Silently closed (no comments/reviews)
- Duplicate retry attempts
- Failed dependency upgrade
- Scope mismatch / not needed
- Unresolved merge conflicts
- Agent unable to complete
- Other / unclear

## Architecture

```
src/
├── types.ts           — TypeScript interfaces
├── config.ts          — .env reader + validation
├── github-client.ts   — Octokit + retry logic
├── fetch-prs.ts       — PR discovery + detail fetching
├── compute-metrics.ts — Cost score, autonomous classification
├── classify-abandon.ts — Abandon reason classification
└── fetch-data.ts      — Main orchestrator

docs/
├── index.html         — Dashboard (Chart.js, dark theme)
└── sample-data.json   — Demo data for development
```

## GitHub Pages Deployment

The dashboard auto-deploys to GitHub Pages via GitHub Actions:
- **On push to main**: Collects fresh data and deploys
- **Weekly schedule**: Monday 6am UTC
- **Manual trigger**: `workflow_dispatch`

Configure repo variables in Settings → Actions → Variables:
- `AI_PULSE_REPOS`, `AI_PULSE_START_DATE`, `AI_PULSE_END_DATE`, `AI_PULSE_LABELS`

## License

MIT
