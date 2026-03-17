# AI Pulse — Implementation Plan

## Problem Statement

Build `ronniegeraghty/ai-pulse` — a public repo containing a TypeScript data collection tool and a GitHub Pages dashboard that visualizes Copilot coding agent PR statistics. Supports the "Prepare Copilot Signals Segment for All Hands (March 23)" board item. Inspired by [timotheeguerin/tsp-copilot-stats](https://github.com/timotheeguerin/tsp-copilot-stats) but generalized to be configurable across any GitHub repos, with richer metrics and more visualizations.

---

## Architecture

```
ai-pulse/
├── .env.example                    # Template — documents all env vars with comments
├── .env                            # User's local config (gitignored)
├── .gitignore                      # node_modules, data/, .env
├── package.json                    # Scripts: fetch, dev (local dashboard server)
├── tsconfig.json                   # ESM, strict, NodeNext
├── README.md                       # Setup instructions, env var docs, screenshot
├── src/
│   ├── types.ts                    # All TypeScript interfaces
│   ├── config.ts                   # Reads .env via dotenv, validates, exports typed config
│   ├── github-client.ts            # Octokit factory, withRetry helper, token resolution
│   ├── fetch-prs.ts                # Find Copilot PRs via Search API, fetch details
│   ├── compute-metrics.ts          # Per-PR: cost score, autonomous, human intervention
│   ├── classify-abandon.ts         # Abandon reason classification (12 categories)
│   └── fetch-data.ts               # Main entry: config → fetch → compute → classify → write JSON
├── data/                           # Generated output (gitignored)
│   └── .gitkeep
├── docs/                           # GitHub Pages source
│   ├── index.html                  # Dashboard SPA — Chart.js, dark theme, filter controls
│   └── sample-data.json            # Demo data for local dev without running fetch
└── .github/
    └── workflows/
        └── collect-and-deploy.yml  # Weekly scheduled fetch + Pages deploy
```

### Technology Choices

| Choice | Why |
|--------|-----|
| **TypeScript + Node.js (ESM)** | Same stack as reference repo; Octokit has first-class TS types; `tsx` runner avoids compile step |
| **@octokit/rest** | Proven GitHub API client — pagination, retry, rate limits. Reference uses it successfully |
| **dotenv** | Standard `.env` file parsing. Lightweight, zero-config |
| **Chart.js 4 + chartjs-adapter-date-fns** | Lightweight charting via CDN. No build pipeline. Reference proves it handles all these chart types |
| **Static HTML (single file, no framework)** | `docs/index.html` — no build step, instant GitHub Pages deploy, easy to maintain |
| **GitHub Actions** | New repo under ronniegeraghty (not squad HQ) — Actions budget is available |

### npm Scripts

```json
{
  "scripts": {
    "fetch": "tsx src/fetch-data.ts",
    "dev": "npx serve docs"
  }
}
```

### Dependencies

```json
{
  "dependencies": {
    "@octokit/rest": "^21.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0"
  }
}
```

---

## Configuration — Environment Variables

All configuration lives in a `.env` file at the project root. The `.env.example` documents every variable.

```bash
# ──────────────────────────────────────────────
# AI Pulse Configuration
# ──────────────────────────────────────────────

# REQUIRED: Comma-separated list of GitHub repos to analyze (owner/repo format)
AI_PULSE_REPOS="Azure/azure-sdk-tools,Azure/azure-sdk-for-rust,Azure/azure-sdk-for-net"

# REQUIRED: Date range for PR collection (inclusive, based on PR created_at)
# Format: YYYY-MM-DD
AI_PULSE_START_DATE="2025-01-01"
AI_PULSE_END_DATE="2025-12-31"

# OPTIONAL: Comma-separated PR labels to filter by.
# Only PRs that have at least one of these labels will be collected.
# If empty or unset, ALL Copilot PRs in the date range are collected regardless of labels.
AI_PULSE_LABELS=""

# OPTIONAL: Comma-separated GitHub logins that are considered "AI" authors.
# Used to distinguish AI commits from human commits on PR branches.
# Default: "copilot,copilot[bot]"
AI_PULSE_AI_LOGINS="copilot,copilot[bot]"

# OPTIONAL: Number of days of inactivity after which an open PR is considered "abandoned".
# Inactivity is measured from PR's updated_at field to now.
# Default: 14
AI_PULSE_INACTIVE_DAYS="14"

# OPTIONAL: GitHub token. If not set, falls back to `gh auth token` CLI command.
# Needs `repo` scope for private repos, or no special scope for public repos.
GITHUB_TOKEN=""
```

### Config validation rules (in `config.ts`)

- `AI_PULSE_REPOS` — REQUIRED. At least one repo. Each must match `owner/repo` format.
- `AI_PULSE_START_DATE` — REQUIRED. Must be valid ISO date. Must be ≤ END_DATE.
- `AI_PULSE_END_DATE` — REQUIRED. Must be valid ISO date. Must be ≥ START_DATE.
- `AI_PULSE_LABELS` — OPTIONAL. Empty string = no label filter (collect all Copilot PRs).
- `AI_PULSE_AI_LOGINS` — OPTIONAL. Defaults to `["copilot", "copilot[bot]"]`.
- `AI_PULSE_INACTIVE_DAYS` — OPTIONAL. Defaults to `14`. Must be positive integer.
- `GITHUB_TOKEN` — OPTIONAL. If missing, resolve via `execSync("gh auth token")`.

The dashboard's web UI will mirror these as URL parameters:
- `?repos=Azure/azure-sdk-tools,Azure/azure-sdk-for-rust`
- `?start=2025-01-01&end=2025-12-31`
- `?labels=copilot`

These override the baked-in config from the JSON data file, allowing client-side re-filtering of pre-fetched data.

---

## TypeScript Interfaces (`src/types.ts`)

```typescript
export interface PRData {
  // Identity
  number: number;
  title: string;
  url: string;                    // HTML URL to the PR
  author: string;                 // PR author login (e.g., "copilot")
  repo: string;                   // "owner/repo" format

  // State
  state: "merged" | "abandoned";  // See classification rules below
  labels: string[];               // All label names on the PR

  // Timestamps
  createdAt: string;              // ISO 8601
  closedAt: string | null;
  mergedAt: string | null;
  updatedAt: string;              // For inactivity check

  // Time metrics
  timeToMergeDays: number | null; // Days from createdAt to mergedAt (includes draft time). Null if not merged.

  // Comment metrics
  commentCount: number;           // GitHub issue comments (discussion thread)
  reviewCommentCount: number;     // GitHub inline review comments

  // Commit analysis
  totalCommits: number;
  copilotCommits: number;         // Commits by AI logins (after filtering inherited)
  humanCommits: number;           // Commits by non-AI logins (after filtering inherited)
  inheritedCommits: number;       // Commits with author.date < (PR.created_at - 5 minutes)
  hadHumanPush: boolean;          // humanCommits > 0
  humanAuthors: string[];         // Unique logins of human commit authors

  // Review analysis
  reviewRounds: number;           // Count of CHANGES_REQUESTED reviews

  // Cost score (see formula below)
  costScore: number;

  // Abandon analysis (only for abandoned PRs)
  abandonReason?: string;         // Reason key from classification
  supersededBy?: {                // If superseded, the replacement PR
    number: number;
    title: string;
    author: string;
  } | null;
}

export interface AbandonReasonSummary {
  reason: string;                 // Machine key (e.g., "superseded_by_copilot")
  count: number;
  percentage: number;             // Of total abandoned PRs
  description: string;            // Human-readable (e.g., "Superseded by another Copilot PR")
}

export interface RepoData {
  prs: PRData[];
  abandonReasons: AbandonReasonSummary[];
}

export interface CollectionConfig {
  repos: string[];
  startDate: string;
  endDate: string;
  labels: string[];
  aiLogins: string[];
  inactiveDays: number;
}

export interface OutputData {
  generatedAt: string;            // ISO 8601 timestamp of when data was collected
  config: CollectionConfig;       // The config used for this collection run
  repos: Record<string, RepoData>; // Keyed by "owner/repo"
}
```

---

## Data Collection Pipeline

### Step 1: Token Resolution (`github-client.ts`)

```
1. Check process.env.GITHUB_TOKEN
2. If empty, try execSync("gh auth token").trim()
3. If both fail, error with clear message
```

Create Octokit instance. Log rate limit status at start.

### Step 2: Retry Helper (`github-client.ts`)

`withRetry<T>(fn, retries=3, delay=5000)`:
- On 403 with `x-ratelimit-remaining: 0` → wait until reset time + 1s, then retry
- On other 4xx (except 403) → throw immediately (not retryable)
- On 5xx or network error → exponential backoff retry
- Max 3 retries

### Step 3: Find Copilot PRs (`fetch-prs.ts`)

For each repo in config:

```typescript
// Search for ALL copilot-authored PRs in the date range
// We search for merged, unmerged (closed but not merged), and open separately
for (const stateFilter of ["is:merged", "is:unmerged", "is:open"]) {
  const q = `is:pr author:app/copilot ${stateFilter} repo:${owner}/${repo} created:${startDate}..${endDate}`;
  // Paginate through all results (100 per page, max 1000 from search API)
}
```

**Why include `is:open`**: We need to detect PRs that are still open but have been inactive for ≥ `AI_PULSE_INACTIVE_DAYS` days. These count as "abandoned" per the spec.

**Label filtering**: After collecting PR numbers from search, if `config.labels` is non-empty, filter to only PRs that have at least one of the specified labels. This happens during the detail-fetch step (Step 4) since we have full label data there.

### Step 4: Fetch PR Details (`fetch-prs.ts`)

For each PR number found in Step 3, fetch 3 API calls in parallel:

```typescript
const [prRes, commitsRes, reviewsRes] = await Promise.all([
  withRetry(() => octokit.pulls.get({ owner, repo, pull_number: prNumber })),
  withRetry(() => octokit.pulls.listCommits({ owner, repo, pull_number: prNumber, per_page: 100 })),
  withRetry(() => octokit.pulls.listReviews({ owner, repo, pull_number: prNumber, per_page: 100 })),
]);
```

**Concurrency**: Process 10 PRs at a time using batch slicing (matching reference).

**State classification** (determines `state` field):
- If `pr.merged_at` is truthy → `state = "merged"`
- If `pr.state === "closed"` and `pr.merged_at` is falsy → `state = "abandoned"`
- If `pr.state === "open"` and `(now - pr.updated_at) >= INACTIVE_DAYS` → `state = "abandoned"`
- If `pr.state === "open"` and recently active → **skip this PR** (it's still in progress, not a final state)

**Label filtering** (if config.labels is non-empty):
- Check `pr.labels` against `config.labels`
- If PR has none of the specified labels → skip

### Step 5: Compute Per-PR Metrics (`compute-metrics.ts`)

#### 5a: Commit Classification (Human vs AI)

```typescript
const copilotLogins = new Set(config.aiLogins.map(l => l.toLowerCase()));
// e.g., Set(["copilot", "copilot[bot]"])

const prCreatedAt = new Date(pr.created_at).getTime();
const inheritedCutoff = prCreatedAt - (5 * 60 * 1000); // 5 minutes before PR creation

for (const commit of commits) {
  const commitDate = new Date(commit.commit.author?.date ?? 0).getTime();

  if (commitDate < inheritedCutoff) {
    // INHERITED: This commit predates the PR — it was on the branch/base before the PR was opened
    inheritedCommits++;
    continue;
  }

  const authorLogin = (commit.author?.login ?? "").toLowerCase();
  if (copilotLogins.has(authorLogin)) {
    copilotCommits++;
  } else {
    humanCommits++;
    humanAuthorSet.add(commit.author?.login);
  }
}

hadHumanPush = humanCommits > 0;
```

**Key rule**: The 5-minute buffer (`PR.created_at - 5 minutes`) is a heuristic to avoid counting commits that were already on the branch before the PR was opened. This is inherited from the reference implementation and accounts for timing differences between the commit being authored and the PR being created.

#### 5b: Fully Autonomous Classification

A PR is **Fully Autonomous** if:
1. `PR.state === "merged"`, AND
2. `hadHumanPush === false` (no human-authored commits after filtering inherited)

Humans may still comment or review — the key question is whether humans had to **push code** to the PR branch.

Over a time period:
- `fullyAutonomousCount = count(PR where state === "merged" && !hadHumanPush)`
- `fullyAutonomousRate = fullyAutonomousCount / totalMergedCount`

#### 5c: Cost Score

```typescript
function computeCostScore(params: {
  humanCommits: number;       // Non-AI commits (weight: 3)
  reviewRounds: number;       // CHANGES_REQUESTED reviews (weight: 2)
  reviewCommentCount: number; // Inline review comments (weight: 0.3)
  commentCount: number;       // Discussion/issue comments (weight: 0.2)
  abandoned: boolean;         // Penalty: +5 if PR is abandoned
}): number {
  const score =
    params.humanCommits * 3 +
    params.reviewRounds * 2 +
    params.reviewCommentCount * 0.3 +
    params.commentCount * 0.2 +
    (params.abandoned ? 5 : 0);
  return Math.round(score * 10) / 10; // Round to 1 decimal place
}
```

**Review rounds**: Count of reviews in state `"CHANGES_REQUESTED"` (not APPROVED, not COMMENTED, not PENDING).

**Avg Cost Score** over a time period: mean of costScore over ALL PRs in that period (merged + abandoned), not just merged.

#### 5d: Time to Merge

```typescript
if (pr.merged_at) {
  const created = new Date(pr.created_at).getTime();
  const merged = new Date(pr.merged_at).getTime();
  timeToMergeDays = Math.round(((merged - created) / (1000 * 60 * 60 * 24)) * 10) / 10;
}
```

**Important**: Uses `created_at`, NOT `ready_for_review_at`. This means draft time IS included in the merge time calculation, as specified.

#### 5e: Merge Rate

```
Merge Rate = merged / (merged + abandoned) * 100
```

Where the denominator includes:
- PRs that are merged
- PRs that are closed without merging
- PRs that are open but have had no activity for ≥ INACTIVE_DAYS (treated as abandoned)

PRs that are open and recently active are **excluded** from both numerator and denominator (they haven't reached a final state yet).

#### 5f: Average Comments

```
Avg Comments = mean(pr.commentCount) across all Copilot PRs
```

Where `commentCount` is the number of **human** comments on the PR. This is `pr.comments` from the GitHub API (issue thread comments). We may also consider including `pr.review_comments` (inline review comments) — but the primary metric is issue comments to approximate "how much discussion did this PR generate."

**Note**: The reference repo uses `pr.comments` for commentCount and `pr.review_comments` for reviewCommentCount separately. The "Average Comments on PRs" summary card shows the mean of issue comments (`pr.comments`). Review comments are captured separately for the cost score formula.

### Step 6: Classify Abandon Reasons (`classify-abandon.ts`)

For each abandoned PR, fetch issue comments and reviews, then classify:

| Reason Key | Description | Detection Logic |
|------------|-------------|-----------------|
| `superseded_by_copilot` | Superseded by another Copilot PR | Comments mention another PR + that PR is merged + author is AI |
| `superseded_by_human` | Superseded by a human PR | Comments mention another PR + that PR is merged + author is human |
| `superseded` | Superseded by another PR (unknown author) | Comments contain "replaced by", "moved to", "closing in favor", "handled in", etc. but superseding PR can't be verified |
| `wip_stuck` | Agent stuck in WIP loop (repeated attempts) | Title starts with "[WIP]" or "WIP" |
| `failed_review_feedback` | Failed to address review feedback | Last review state is CHANGES_REQUESTED, or reviewCommentCount > 5 |
| `silently_closed` | Silently closed with no comments or reviews | `commentCount === 0 && reviewCommentCount === 0` |
| `duplicate_retry` | Duplicate retry attempts (same task) | Multiple abandoned PRs with same normalized title |
| `failed_dep_upgrade` | Failed dependency upgrade | Title matches patterns: "upgrade dep", "update dep", "bump", "update node", "update packages" |
| `not_needed` | Scope mismatch / not actually needed | Comments contain "not a bug", "close for now", "not needed", "nvm", "no this should" |
| `merge_conflicts` | Unresolved merge conflicts | Comments mention "conflict" |
| `agent_unable` | Agent explicitly unable to complete | Comments contain "unable to handle", "copilot is unable" |
| `agent_error` | Agent crashed with unexpected error | Comments contain "unexpected error" |
| `other` | Other / unclear reason | None of the above matched |

**Title normalization for duplicate detection**: Strip `[WIP]`, `[Python]`, `[Copilot]`, etc. prefixes, lowercase, trim. If ≥2 abandoned PRs share the same normalized title, mark as `duplicate_retry` (unless already `wip_stuck`).

**Superseding PR detection**: Extract PR references (`#NNN`, `/pull/NNN`) from comments. For each reference, check if it's a merged PR. If so, check the author — AI vs human determines the superseded subcategory.

**Keyword-based superseding search** (fallback for unclassified PRs): Search GitHub for merged PRs with similar title keywords in the same repo, within 60 days. If found, mark as superseded.

**Output**: Array of `AbandonReasonSummary` sorted by count descending, with percentage of total abandoned.

### Step 7: Write Output (`fetch-data.ts`)

Write `data/pr-stats.json`:

```json
{
  "generatedAt": "2025-03-17T22:00:00.000Z",
  "config": {
    "repos": ["Azure/azure-sdk-tools", "Azure/azure-sdk-for-rust"],
    "startDate": "2025-01-01",
    "endDate": "2025-12-31",
    "labels": ["copilot"],
    "aiLogins": ["copilot", "copilot[bot]"],
    "inactiveDays": 14
  },
  "repos": {
    "Azure/azure-sdk-tools": {
      "prs": [
        {
          "number": 1234,
          "title": "Fix auth endpoint",
          "url": "https://github.com/Azure/azure-sdk-tools/pull/1234",
          "author": "copilot",
          "repo": "Azure/azure-sdk-tools",
          "state": "merged",
          "labels": ["copilot", "bug"],
          "createdAt": "2025-03-01T10:00:00Z",
          "closedAt": "2025-03-02T14:00:00Z",
          "mergedAt": "2025-03-02T14:00:00Z",
          "updatedAt": "2025-03-02T14:00:00Z",
          "timeToMergeDays": 1.2,
          "commentCount": 2,
          "reviewCommentCount": 3,
          "totalCommits": 4,
          "copilotCommits": 3,
          "humanCommits": 1,
          "inheritedCommits": 0,
          "hadHumanPush": true,
          "humanAuthors": ["somedev"],
          "reviewRounds": 1,
          "costScore": 6.1
        }
      ],
      "abandonReasons": [
        { "reason": "failed_review_feedback", "count": 5, "percentage": 33, "description": "Failed to address review feedback" }
      ]
    }
  }
}
```

Console output during collection:
```
GitHub API rate limit: 4800/5000 (resets at 2025-03-17T23:00:00Z)

Processing Azure/azure-sdk-tools...
  Searching for PRs authored by @copilot...
  Search is:merged page 1: 45 PRs (total: 45)
  Search is:unmerged page 1: 12 PRs (total: 12)
  Search is:open page 1: 3 PRs (total: 3)
  Found 60 Copilot-authored PRs.
  Fetching details for 60 PRs (concurrency: 10)...
    Fetched 10/60 PRs
    ...
  Classifying 15 abandoned PRs...
  Total: 57 closed Copilot PRs (42 merged, 15 abandoned)
  Human intervention: 8 PRs (14.0%) had human commits

Data written to data/pr-stats.json
```

---

## Dashboard — `docs/index.html`

### Design

- **Dark theme** matching reference: `--bg: #0d1117`, `--surface: #161b22`, `--border: #30363d`, `--text: #e6edf3`
- **Color palette**: green (#3fb950) for merged/positive, red (#f85149) for abandoned/negative, blue (#58a6ff) for accent, orange (#d29922) for warning/neutral
- **Layout**: Header → Controls → Summary Cards (6-column grid) → Charts Grid (2-column, some full-width)
- **Responsive**: Charts grid collapses to 1-column on narrow screens; side panel moves below on mobile

### Data Loading

Dashboard loads data in one of three ways (tried in order):
1. **URL parameter**: `?data=URL` — fetch JSON from that URL
2. **Default path**: Try `./data/pr-stats.json` (works on GitHub Pages after deploy)
3. **File upload**: Button to upload a local `pr-stats.json` file
4. **Sample data**: "Load sample data" button loads `sample-data.json` for demo

### Web UI Filter Controls (top of page)

```
┌──────────────────────────────────────────────────────────────────┐
│ Repository: [All Repos ▾]  From: [____]  To: [____]  Area: [All ▾] │
└──────────────────────────────────────────────────────────────────┘
```

- **Repository**: `<select>` populated from loaded data's repo keys. "All Repos" default.
- **From / To**: `<input type="date">` — pre-filled from config in JSON. User can narrow the range.
- **Area**: `<select>` populated from all unique labels across all PRs. "All Areas" default.
- **All filters are client-side** — they slice/dice the pre-loaded JSON. No API calls.
- **URL parameter sync**: When filters change, URL params update (`?repos=...&start=...&end=...&labels=...`). On page load, URL params pre-set filters. This means you can share a link with specific filter settings.

### Summary Cards

Six cards in a responsive grid at the top:

```
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│     142      │ │    72.5%     │ │    1.8d      │ │     3.2      │ │    58.3%     │ │     2.4      │
│ Total Copilot│ │ Merge Rate   │ │ Avg Time to  │ │ Avg Comments │ │   Fully      │ │  Avg Cost    │
│     PRs      │ │              │ │    Merge     │ │   per PR     │ │ Autonomous   │ │   Score      │
│    (blue)    │ │   (green)    │ │  (orange)    │ │    (red)     │ │   (green)    │ │  (orange)    │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

Calculations (all responsive to current filter state):

1. **Total Copilot PRs** (blue) — `count(filteredPRs)` — total PRs matching current filters
2. **Merge Rate** (green) — `merged / (merged + abandoned) * 100` — percentage with `%` suffix. Only PRs with a final state (merged, closed-not-merged, or open-inactive-2-weeks). Open+active PRs excluded from denominator.
3. **Avg Time to Merge** (orange) — `mean(timeToMergeDays for merged PRs)` — displayed as `Xd` (days). Time from `createdAt` to `mergedAt`, including draft time.
4. **Avg Comments per PR** (red) — `mean(commentCount for all PRs)` — the average number of human comments (issue thread comments) across all copilot PRs.
5. **Fully Autonomous** (green) — `count(merged && !hadHumanPush) / count(merged) * 100` — percentage of merged PRs where no human pushed code to the branch.
6. **Avg Cost Score** (orange) — `mean(costScore for all PRs)` — mean of `3*humanCommits + 2*reviewRounds + 0.3*reviewCommentCount + 0.2*commentCount + 5*(if abandoned)` across all PRs (merged + abandoned).

### Chart 1: Merged vs Abandoned by Week

**Type**: Stacked vertical bar chart
**X-axis**: Weeks (ISO week labels, e.g., "Mar 3", "Mar 10")
**Y-axis**: Number of PRs
**Stacks** (bottom to top):
- **Merged** (green #3fb950) — count of merged PRs created in that week
- **Abandoned** (red #f85149) — count of abandoned PRs (closed-not-merged + open-inactive) created in that week

**Grouping**: PRs grouped by the week of their `createdAt` date.

### Chart 2: Average Comments per PR by Week

**Type**: Bar chart (single series)
**X-axis**: Weeks
**Y-axis**: Average number of comments
**Bar color**: Blue (#58a6ff)
**Value**: For each week, `mean(commentCount)` of all Copilot PRs created that week.

### Chart 3: Average Time to Merge by Week (in days)

**Type**: Bar chart (single series)
**X-axis**: Weeks
**Y-axis**: Days
**Bar color**: Orange (#d29922)
**Value**: For each week, `mean(timeToMergeDays)` of merged PRs created that week. Only merged PRs are included (abandoned PRs have no merge time).

### Chart 4: Human Intervention by Week

**Type**: Stacked vertical bar chart
**X-axis**: Weeks
**Y-axis**: Number of PRs
**Stacks** (bottom to top):
- **Autonomous** (green #3fb950) — merged PRs with `hadHumanPush === false` (no human commits)
- **Human-assisted** (orange #d29922) — merged PRs with `hadHumanPush === true` (has human commits)
- **Abandoned** (red #f85149) — abandoned PRs

**Grouping**: By week of `createdAt`.

### Chart 5: Cost Score Distribution

**Type**: Vertical bar chart (single series, categorical x-axis)
**X-axis**: Cost score buckets (categorical labels)
**Y-axis**: Number of PRs
**Buckets**:
| Bucket | Range | Color | Label |
|--------|-------|-------|-------|
| Autonomous | costScore === 0 | Green #3fb950 | "0 (Autonomous)" |
| Low | 0.1 ≤ costScore ≤ 3 | Blue #58a6ff | "0.1–3 (Low)" |
| Medium | 3 < costScore ≤ 6 | Orange #d29922 | "3–6 (Medium)" |
| High | 6 < costScore ≤ 10 | Red-orange #f47067 | "6–10 (High)" |
| Very High | costScore > 10 | Red #f85149 | "10+ (Very High)" |

Each bar shows the count of PRs falling into that bucket.

### Chart 6: Avg Cost Score by Week

**Type**: Bar chart (single series)
**X-axis**: Weeks
**Y-axis**: Average cost score
**Bar color**: Orange (#d29922)
**Value**: For each week, `mean(costScore)` of ALL PRs created that week (merged + abandoned, matching the reference implementation).

### Chart 7: PRs by Area (Labels)

**Type**: Horizontal stacked bar chart
**Y-axis**: Label names (one row per label)
**X-axis**: Number of PRs
**Stacks** (left to right):
- **Merged** (green #3fb950) — count of merged PRs with that label
- **Abandoned** (red #f85149) — count of abandoned PRs with that label

**How labels are counted**: A single PR with labels `["copilot", "bug", "sdk"]` contributes 1 to each of those label rows. This means the sum of all label bars may exceed the total PR count.

**Sorting**: Labels sorted by total PR count descending.

### Chart 8: Avg Cost Score by Area

**Type**: Horizontal bar chart (single series)
**Y-axis**: Label names (one row per label)
**X-axis**: Average cost score
**Bar color**: Orange (#d29922)
**Value**: For each label, `mean(costScore)` of all Copilot PRs that have that label.

**Sorting**: Labels sorted by avg cost score descending.

### Chart 9: PRs by Area Over Time by Week

**Type**: Stacked vertical bar chart
**X-axis**: Weeks
**Y-axis**: Number of PRs
**Stacks**: One stack per label, each with a distinct color from a palette. Each stack shows how many Copilot PRs with that label were created in that week.

**Color palette**: Cycle through a set of distinguishable colors. Use Chart.js's default palette or define ~10 colors.

**Note**: A PR with multiple labels counts in multiple stacks. The chart shows label volume distribution over time.

### Chart 10: Why Copilot PRs Get Abandoned

**Type**: Horizontal bar chart (single series)
**Y-axis**: Reason descriptions (one row per reason)
**X-axis**: Number of PRs
**Bar color**: Red (#f85149)
**Data source**: `abandonReasons` array from the JSON (pre-computed during collection)

**Reason labels** (human-readable descriptions):
| Key | Display Label |
|-----|---------------|
| `superseded_by_copilot` | Superseded by another Copilot PR |
| `wip_stuck` | Agent stuck in WIP loop (repeated attempts) |
| `failed_review_feedback` | Failed to address review feedback |
| `silently_closed` | Silently closed with no comments or reviews |
| `superseded_by_human` | Superseded by a human PR |
| `duplicate_retry` | Duplicate retry attempts (same task) |
| `failed_dep_upgrade` | Failed dependency upgrade |
| `superseded` | Superseded by another PR (unknown author) |
| `not_needed` | Scope mismatch / not actually needed |
| `merge_conflicts` | Unresolved merge conflicts |
| `agent_unable` | Agent explicitly unable to complete |
| `agent_error` | Agent crashed with unexpected error |
| `other` | Other / unclear reason |

**Sorting**: By count descending.

**Interactivity**: Clicking a bar could show a side panel listing the specific PRs in that category (matching the reference dashboard's side panel pattern). Each PR entry shows: `#number: title (days since created)` with a link to the PR.

### Side Panel (PR Drill-Down)

When a user clicks a chart element (bar segment, abandon reason), a side panel slides in from the right showing the individual PRs:

```
┌─────────────────────────────────────┐
│ Failed to address review feedback   │
│ 5 PRs                          [✕]  │
├─────────────────────────────────────┤
│ #1234 Fix auth endpoint timeout     │
│   Cost: 6.1 · 2 comments · 3d ago  │
│                                     │
│ #1189 Update SDK generation config  │
│   Cost: 4.2 · 5 comments · 8d ago  │
│                                     │
│ ...                                 │
└─────────────────────────────────────┘
```

Each PR entry links to GitHub. The panel is dismissible. On mobile, it appears below the chart instead of beside it.

---

## GitHub Actions Workflow (`collect-and-deploy.yml`)

```yaml
name: Collect Data & Deploy Dashboard

on:
  push:
    branches: [main]
  workflow_dispatch:          # Manual trigger
  schedule:
    - cron: "0 6 * * 1"      # Every Monday at 6am UTC

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - name: Fetch PR data
        run: npm run fetch
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AI_PULSE_REPOS: ${{ vars.AI_PULSE_REPOS }}
          AI_PULSE_START_DATE: ${{ vars.AI_PULSE_START_DATE }}
          AI_PULSE_END_DATE: ${{ vars.AI_PULSE_END_DATE }}
          AI_PULSE_LABELS: ${{ vars.AI_PULSE_LABELS }}

      - name: Prepare site
        run: |
          mkdir -p _site/data
          cp docs/index.html _site/index.html
          cp data/pr-stats.json _site/data/pr-stats.json

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

      - id: deployment
        uses: actions/deploy-pages@v4
```

**Repository variables** (set in GitHub repo settings → Actions → Variables):
- `AI_PULSE_REPOS` — the repos to collect from
- `AI_PULSE_START_DATE` — start date
- `AI_PULSE_END_DATE` — end date
- `AI_PULSE_LABELS` — label filter

**Secrets**: Uses `GITHUB_TOKEN` (automatic) for public repos. For private repos, set a PAT as `GITHUB_TOKEN` secret.

---

## Implementation Todos

### Phase 1: Repo Setup
1. **create-repo** — Create `ronniegeraghty/ai-pulse` as a public GitHub repo. Initialize with README stub, `.gitignore` (Node), and MIT license.
2. **scaffold-project** — Clone locally. Create `package.json` (with `fetch` and `dev` scripts), `tsconfig.json` (ESM, strict, NodeNext), `.env.example` (all env vars documented), `src/` directory, `data/.gitkeep`, `docs/` directory. Install dependencies (`@octokit/rest`, `dotenv`, `tsx`, `typescript`, `@types/node`).

### Phase 2: Data Collection (src/)
3. **types-and-config** — Create `src/types.ts` with all interfaces (PRData, RepoData, OutputData, CollectionConfig, AbandonReasonSummary). Create `src/config.ts` that reads `.env` via dotenv, validates all fields, and exports a typed `CollectionConfig` object.
4. **github-client** — Create `src/github-client.ts` with token resolution (GITHUB_TOKEN env → `gh auth token` fallback), Octokit factory, and `withRetry` helper (rate limit aware, exponential backoff, max 3 retries).
5. **fetch-prs** — Create `src/fetch-prs.ts` with two functions: `findCopilotPRNumbers(octokit, owner, repo, config)` (Search API, 3 state filters, date range, pagination) and `fetchPRDetails(octokit, owner, repo, prNumbers, config)` (parallel detail fetch with concurrency=10, state classification including inactive-open→abandoned, label filtering).
6. **compute-metrics** — Create `src/compute-metrics.ts` with: `classifyCommits(commits, prCreatedAt, aiLogins)` (inherited filtering, AI vs human), `computeCostScore(params)` (exact formula: 3*human + 2*reviews + 0.3*reviewComments + 0.2*comments + 5*abandoned, round to 1 decimal), `computePRMetrics(pr, commits, reviews, config)` (assembles full PRData object).
7. **classify-abandon** — Create `src/classify-abandon.ts` with `classifyAbandonReason(pr, comments, lastReviewState)` (12 reason types), `classifyAbandonedPRs(octokit, owner, repo, prs)` (fetches comments/reviews for abandoned PRs, runs classification, detects duplicates, searches for superseding PRs), and `REASON_DESCRIPTIONS` map.
8. **fetch-orchestrator** — Create `src/fetch-data.ts` as main entry point: load config → log rate limit → for each repo: findCopilotPRNumbers → fetchPRDetails → classify abandoned → collect stats → write `data/pr-stats.json`. Console output shows progress.

### Phase 3: Dashboard (docs/)
9. **dashboard-scaffold** — Create `docs/index.html` with: HTML structure (header, controls bar, summary cards grid, charts grid, side panel), CSS (dark theme with CSS variables, responsive grid, card styles, chart container styles), Chart.js + date-fns adapter CDN includes, data loading logic (file upload, URL fetch, default path), global state management (loaded data, current filters, chart instances).
10. **dashboard-charts** — Implement all 10 charts: (1) Merged vs Abandoned/week stacked bar, (2) Avg Comments/week bar, (3) Avg TTM/week bar, (4) Human Intervention/week stacked bar, (5) Cost Score Distribution categorical bar, (6) Avg Cost Score/week bar, (7) PRs by Area horizontal stacked bar, (8) Avg Cost by Area horizontal bar, (9) PRs by Area Over Time stacked vertical bar, (10) Abandon Reasons horizontal bar. Each chart has its own render function that receives filtered PR data and returns a Chart.js instance.
11. **dashboard-filters** — Implement filter controls: repo `<select>`, date `<input type="date">` × 2, area `<select>`. Wire `onchange` handlers to re-filter data and call `updateDashboard()`. Sync filters ↔ URL parameters (read on load, write on change). Populate dropdowns from loaded data.
12. **dashboard-abandon-detail** — Implement side panel: click handler on abandon reason bars → shows scrollable PR list with number, title, cost score, comment count, link to GitHub. Sticky positioning on desktop, below chart on mobile. Close button.

### Phase 4: Deployment & Polish
13. **github-actions** — Create `.github/workflows/collect-and-deploy.yml` with scheduled weekly run, workflow_dispatch, push-to-main trigger. Uses repo variables for config. Builds site to `_site/` and deploys to GitHub Pages.
14. **sample-data** — Generate a realistic `docs/sample-data.json` with ~50 PRs across 2 repos, covering all states, cost score ranges, abandon reasons, and label distributions. Used for local dev and demo.

### Phase 5: Test & Verify
15. **test-fetch** — Run `npm run fetch` against a real repo to verify data collection works end-to-end. Validate output JSON structure matches types.
16. **test-dashboard** — Open dashboard locally (`npm run dev`), load sample data, verify all 10 charts render correctly, filters work, side panel opens/closes, URL params sync.

---

## Execution Strategy

### Task Tracking
- The plan and all tasks live **in the repo** as committed markdown:
  - `docs/PLAN.md` — this full plan (reference spec)
  - `docs/TASKS.md` — granular task list with status tracking
- Each task is the smallest implementable unit of work.
- Every implementation task is followed by a **verification task** that checks the work.

### Parallel Execution
- Tasks are organized into waves. All tasks within a wave can run in parallel.
- Each task is worked on by a **fresh Legolas subagent** (no state carried between tasks).
- The subagent completing a task **does NOT** verify it — a new subagent runs the verification task.
- Subagents update `docs/TASKS.md` when they complete work (mark task as ✅).

### Wave Structure (dependency analysis)

**Wave 1** (repo setup — sequential, must be first):
- T01: Create repo + initial scaffold

**Wave 2** (foundation — can be parallel after Wave 1):
- T02: types.ts
- T03: config.ts
- T04: github-client.ts
- V02: Verify types.ts
- V03: Verify config.ts
- V04: Verify github-client.ts

**Wave 3** (data collection modules — parallel, depend on Wave 2):
- T05: fetch-prs.ts
- T06: compute-metrics.ts
- T07: classify-abandon.ts
- V05: Verify fetch-prs.ts
- V06: Verify compute-metrics.ts
- V07: Verify classify-abandon.ts

**Wave 4** (orchestrator + sample data — parallel, depend on Wave 3):
- T08: fetch-data.ts (main orchestrator)
- T09: sample-data.json
- V08: Verify fetch-data.ts
- V09: Verify sample-data.json

**Wave 5** (dashboard — parallel, depend on Wave 1):
- T10: Dashboard HTML/CSS scaffold
- V10: Verify dashboard scaffold

**Wave 6** (dashboard features — parallel, depend on Wave 5):
- T11: Summary cards
- T12: Charts 1-5 (weekly + distribution)
- T13: Charts 6-10 (cost + area + abandon)
- T14: Filter controls + URL params
- V11-V14: Verification tasks for each

**Wave 7** (integration — parallel, depend on Waves 4+6):
- T15: Side panel / abandon drill-down
- T16: GitHub Actions workflow
- T17: README.md documentation
- V15-V17: Verification tasks for each

**Wave 8** (end-to-end testing — sequential, depend on all):
- T18: Full integration test (fetch → dashboard)
- V18: Final verification

---

## Open Questions

1. **Comment counting for "Avg Comments per PR" card**: The spec says "the number of human comments on copilot coding agent PRs." GitHub's `pr.comments` counts issue-thread comments; `pr.review_comments` counts inline review comments. **Plan assumes `pr.comments` (issue thread comments) for the summary card**, matching the reference. Review comments are used separately in the cost score formula.

2. **Inactivity signal for open PRs**: Using `updated_at` as the proxy — this updates on any activity (comments, pushes, label changes, etc.). This is the simplest reliable signal. Alternative: check the latest comment/commit date explicitly. **Plan uses `updated_at`.**

3. **Label filtering when LABELS is empty**: If `AI_PULSE_LABELS` is empty or unset, collect ALL Copilot PRs regardless of labels. **Plan assumes yes.** The "PRs by Area" charts then show distribution across whatever labels exist on the PRs.
