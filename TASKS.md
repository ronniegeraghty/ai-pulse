# AI Pulse — Task Tracker

Status: ⬜ Pending | 🔄 In Progress | ✅ Done | ❌ Failed

## Wave 1: Repo Setup

| ID | Task | Status | Verified |
|----|------|--------|----------|
| T01 | Create repo + initial scaffold | ✅ | — |

## Wave 2: Foundation (parallel)

| ID | Task | Status | Verified |
|----|------|--------|----------|
| T02 | Create `src/types.ts` — All TypeScript interfaces (PRData with 22 fields, RepoData, OutputData, CollectionConfig, AbandonReasonSummary) | ⬜ | ⬜ V02 |
| T03 | Create `src/config.ts` — Read .env via dotenv, validate repos/dates/labels/aiLogins/inactiveDays, export typed CollectionConfig | ⬜ | ⬜ V03 |
| T04 | Create `src/github-client.ts` — Token resolution (env→gh auth fallback), Octokit factory, withRetry (rate limit aware, exponential backoff, max 3) | ⬜ | ⬜ V04 |

## Wave 3: Data Collection Modules (parallel)

| ID | Task | Status | Verified |
|----|------|--------|----------|
| T05 | Create `src/fetch-prs.ts` — findCopilotPRNumbers (Search API, 3 state filters, date range, pagination) + fetchPRDetails (parallel detail fetch, concurrency=10, state classification, label filtering) | ⬜ | ⬜ V05 |
| T06 | Create `src/compute-metrics.ts` — classifyCommits (inherited filter 5min, AI vs human), computeCostScore (3*human+2*reviews+0.3*reviewComments+0.2*comments+5*abandoned, round 1 decimal), computePRMetrics (full PRData assembly) | ⬜ | ⬜ V06 |
| T07 | Create `src/classify-abandon.ts` — 12 reason types, fetch comments+reviews per abandoned PR, title normalization for duplicates, PR reference extraction, keyword search fallback (60-day), REASON_DESCRIPTIONS map | ⬜ | ⬜ V07 |

## Wave 4: Orchestrator + Sample Data (parallel)

| ID | Task | Status | Verified |
|----|------|--------|----------|
| T08 | Create `src/fetch-data.ts` — Main entry: load config → log rate limit → iterate repos → fetch → compute → classify → write data/pr-stats.json with full OutputData structure. Console progress output. | ⬜ | ⬜ V08 |
| T09 | Create `docs/sample-data.json` — ~50 realistic PRs across 2 repos, all states, cost scores 0-15+, all 12 abandon reasons, diverse labels, 8+ weeks. Valid OutputData structure. | ⬜ | ⬜ V09 |

## Wave 5: Dashboard Scaffold

| ID | Task | Status | Verified |
|----|------|--------|----------|
| T10 | Create `docs/index.html` — Dark theme CSS (bg:#0d1117, surface:#161b22, etc.), Chart.js 4 + date-fns adapter CDN, layout (header→controls→cards→charts→side panel), data loading (URL param, default path, file upload, sample), responsive grid | ⬜ | ⬜ V10 |

## Wave 6: Dashboard Features (parallel)

| ID | Task | Status | Verified |
|----|------|--------|----------|
| T11 | Summary cards — 6 cards: Total PRs (blue), Merge Rate % (green), Avg TTM days (orange), Avg Comments (red), Fully Autonomous % (green), Avg Cost Score (orange). Formulas per plan spec. Wire to updateDashboard(). | ⬜ | ⬜ V11 |
| T12 | Charts 1-5 — (1) Merged vs Abandoned/week stacked bar green/red, (2) Avg Comments/week blue bar, (3) Avg TTM/week orange bar days, (4) Human Intervention/week stacked Autonomous+Human-assisted+Abandoned, (5) Cost Score Distribution 5 buckets | ⬜ | ⬜ V12 |
| T13 | Charts 6-10 — (6) Avg Cost Score/week orange bar, (7) PRs by Area horizontal stacked merged/abandoned sorted by total desc, (8) Avg Cost by Area horizontal bar sorted by cost desc, (9) PRs by Area Over Time stacked vertical by week per label, (10) Abandon Reasons horizontal red bars sorted by count desc | ⬜ | ⬜ V13 |
| T14 | Filter controls — Repo select, date pickers ×2, area/label select. Client-side filtering. URL param sync (read on load, write on change). Populate from loaded data. updateDashboard() on change. | ⬜ | ⬜ V14 |

## Wave 7: Integration Features (parallel)

| ID | Task | Status | Verified |
|----|------|--------|----------|
| T15 | Side panel / abandon drill-down — Click abandon bar → scrollable PR list (#number linked, title, cost, comments, age). Sticky desktop, below on mobile. Close button. | ⬜ | ⬜ V15 |
| T16 | GitHub Actions workflow — `.github/workflows/collect-and-deploy.yml`: push main + workflow_dispatch + schedule Mon 6am UTC. Repo vars for config. Build _site/ with HTML + data. Deploy Pages. | ⬜ | ⬜ V16 |
| T17 | README.md — Full setup instructions, env var reference table, npm scripts, architecture overview, link to live dashboard. | ⬜ | ⬜ V17 |

## Wave 8: End-to-End Testing

| ID | Task | Status | Verified |
|----|------|--------|----------|
| T18 | Integration test — Run npm run fetch (small date range, real repo). Load in dashboard. Verify all cards, charts, filters, side panel work end-to-end. | ⬜ | ⬜ V18 |
