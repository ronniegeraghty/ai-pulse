import { Octokit } from "@octokit/rest";
import { withRetry } from "./github-client.js";
import type { PRData, AbandonReasonSummary } from "./types.js";

export const REASON_DESCRIPTIONS: Record<string, string> = {
  superseded_by_copilot: "Superseded by another Copilot PR",
  superseded_by_human: "Superseded by a human PR",
  superseded: "Superseded by another PR (unknown author)",
  wip_stuck: "Agent stuck in WIP loop (repeated attempts)",
  failed_review_feedback: "Failed to address review feedback",
  silently_closed: "Silently closed with no comments or reviews",
  duplicate_retry: "Duplicate retry attempts (same task)",
  failed_dep_upgrade: "Failed dependency upgrade",
  not_needed: "Scope mismatch / not actually needed",
  merge_conflicts: "Unresolved merge conflicts",
  agent_unable: "Agent explicitly unable to complete",
  agent_error: "Agent crashed with unexpected error",
  other: "Other / unclear reason",
};

const STALE_BOT_PATTERNS = [
  "no update for 60 days",
  "no update for 30 days",
  "marked as a stale pr",
];

const SUPERSEDED_KEYWORDS = [
  "replaced by",
  "moved to",
  "closing in favo",
  "handled in",
  "instead",
  "new pr",
  "target release branch",
  "favour of #",
  "favor of #",
];

const DEP_UPGRADE_PATTERNS = [
  /upgrade dep/i,
  /update dep/i,
  /bump/i,
  /update node/i,
  /update packages/i,
];

const NOT_NEEDED_KEYWORDS = [
  "not a bug",
  "close for now",
  "not needed",
  "nvm",
  "no this should",
  "close this",
];

function filterStaleComments(comments: string[]): string[] {
  return comments.filter((c) => {
    const lower = c.toLowerCase();
    return !STALE_BOT_PATTERNS.some((p) => lower.includes(p));
  });
}

function classifyAbandonReason(
  pr: PRData,
  comments: string[],
  lastReviewState: string
): string {
  const filtered = filterStaleComments(comments);
  const allText = filtered.join(" ").toLowerCase();

  // 1. superseded
  if (SUPERSEDED_KEYWORDS.some((kw) => allText.includes(kw))) {
    return "superseded";
  }

  // 2. wip_stuck
  if (/^\[?wip\]?/i.test(pr.title)) {
    return "wip_stuck";
  }

  // 3. failed_review_feedback
  if (lastReviewState === "CHANGES_REQUESTED" || pr.reviewCommentCount > 5) {
    return "failed_review_feedback";
  }

  // 4. agent_unable
  if (
    allText.includes("unable to handle") ||
    allText.includes("copilot is unable")
  ) {
    return "agent_unable";
  }

  // 5. agent_error
  if (allText.includes("unexpected error")) {
    return "agent_error";
  }

  // 6. failed_dep_upgrade
  if (DEP_UPGRADE_PATTERNS.some((re) => re.test(pr.title))) {
    return "failed_dep_upgrade";
  }

  // 7. not_needed — check last comment only
  const lastComment = filtered.length > 0 ? filtered[filtered.length - 1].toLowerCase() : "";
  if (NOT_NEEDED_KEYWORDS.some((kw) => lastComment.includes(kw))) {
    return "not_needed";
  }

  // 8. merge_conflicts — check last comment only
  if (lastComment.includes("conflict")) {
    return "merge_conflicts";
  }

  // 9. silently_closed
  if (pr.commentCount === 0 && pr.reviewCommentCount === 0) {
    return "silently_closed";
  }

  return "other";
}

export function extractPRReferences(text: string): number[] {
  const refs = new Set<number>();
  // Match #NNN where NNN is 3+ digits
  for (const m of text.matchAll(/#(\d{3,})/g)) {
    refs.add(parseInt(m[1], 10));
  }
  // Match /pull/NNN
  for (const m of text.matchAll(/\/pull\/(\d+)/g)) {
    refs.add(parseInt(m[1], 10));
  }
  return [...refs];
}

function normalizeTitle(title: string): string {
  return title
    .replace(/\[.*?\]\s*/g, "")
    .toLowerCase()
    .trim();
}

export async function classifyAbandonedPRs(
  octokit: Octokit,
  owner: string,
  repo: string,
  prs: PRData[],
  aiLogins: string[]
): Promise<AbandonReasonSummary[]> {
  const abandoned = prs.filter((pr) => pr.state === "abandoned");
  if (abandoned.length === 0) return [];

  const aiLoginsLower = aiLogins.map((l) => l.toLowerCase());

  // Fetch comments + reviews for each abandoned PR (concurrency 10)
  const prDetails = await processWithConcurrency(abandoned, 10, async (pr) => {
    const [commentsRes, reviewsRes] = await Promise.all([
      withRetry(() =>
        octokit.issues.listComments({
          owner,
          repo,
          issue_number: pr.number,
          per_page: 100,
        })
      ),
      withRetry(() =>
        octokit.pulls.listReviews({
          owner,
          repo,
          pull_number: pr.number,
          per_page: 100,
        })
      ),
    ]);

    const comments = commentsRes.data.map((c) => c.body ?? "");
    const reviews = reviewsRes.data;
    const lastReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;
    const lastReviewState = lastReview?.state ?? "";

    return { pr, comments, lastReviewState };
  });

  // Classify each PR
  for (const { pr, comments, lastReviewState } of prDetails) {
    pr.abandonReason = classifyAbandonReason(pr, comments, lastReviewState);
  }

  // Superseding PR detection: for "superseded", "other", "silently_closed"
  const needsSupersedingCheck = prDetails.filter(
    ({ pr }) =>
      pr.abandonReason === "superseded" ||
      pr.abandonReason === "other" ||
      pr.abandonReason === "silently_closed"
  );

  await processWithConcurrency(needsSupersedingCheck, 10, async ({ pr, comments }) => {
    const allText = comments.join(" ");
    const refs = extractPRReferences(allText);

    for (const refNum of refs) {
      try {
        const { data: refPR } = await withRetry(() =>
          octokit.pulls.get({ owner, repo, pull_number: refNum })
        );
        if (refPR.merged_at) {
          const authorLogin = (refPR.user?.login ?? "").toLowerCase();
          const isAI = aiLoginsLower.includes(authorLogin);
          pr.abandonReason = isAI ? "superseded_by_copilot" : "superseded_by_human";
          pr.supersededBy = {
            number: refPR.number,
            title: refPR.title,
            author: refPR.user?.login ?? "",
          };
          break;
        }
      } catch {
        // Referenced PR not found or inaccessible — skip
      }
    }
  });

  // Duplicate title detection
  const titleMap = new Map<string, PRData[]>();
  for (const pr of abandoned) {
    const norm = normalizeTitle(pr.title);
    const list = titleMap.get(norm) ?? [];
    list.push(pr);
    titleMap.set(norm, list);
  }
  for (const group of titleMap.values()) {
    if (group.length >= 2) {
      for (const pr of group) {
        if (pr.abandonReason !== "wip_stuck") {
          pr.abandonReason = "duplicate_retry";
        }
      }
    }
  }

  // Keyword search fallback for remaining "other" / "silently_closed"
  const needsKeywordSearch = abandoned.filter(
    (pr) => pr.abandonReason === "other" || pr.abandonReason === "silently_closed"
  );

  await processWithConcurrency(needsKeywordSearch, 10, async (pr) => {
    const keywords = normalizeTitle(pr.title)
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .join(" ");

    if (!keywords) return;

    const closedDate = pr.closedAt ? new Date(pr.closedAt) : new Date();
    const windowStart = new Date(closedDate);
    windowStart.setDate(windowStart.getDate() - 60);
    const dateRange = `${windowStart.toISOString().split("T")[0]}..${closedDate.toISOString().split("T")[0]}`;

    try {
      const { data: searchResult } = await withRetry(() =>
        octokit.search.issuesAndPullRequests({
          q: `repo:${owner}/${repo} is:pr is:merged ${keywords} closed:${dateRange}`,
          per_page: 5,
        })
      );

      const merged = searchResult.items.find(
        (item) => item.number !== pr.number && item.pull_request?.merged_at
      );
      if (merged) {
        const authorLogin = (merged.user?.login ?? "").toLowerCase();
        const isAI = aiLoginsLower.includes(authorLogin);
        pr.abandonReason = isAI ? "superseded_by_copilot" : "superseded_by_human";
        pr.supersededBy = {
          number: merged.number,
          title: merged.title,
          author: merged.user?.login ?? "",
        };
      }
    } catch {
      // Search failed — leave classification as-is
    }
  });

  // Split remaining "superseded" into subcategories based on supersededBy author
  for (const pr of abandoned) {
    if (pr.abandonReason === "superseded" && pr.supersededBy) {
      const authorLogin = pr.supersededBy.author.toLowerCase();
      pr.abandonReason = aiLoginsLower.includes(authorLogin)
        ? "superseded_by_copilot"
        : "superseded_by_human";
    }
  }

  // Build summary
  const counts = new Map<string, number>();
  for (const pr of abandoned) {
    const reason = pr.abandonReason ?? "other";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }

  const total = abandoned.length;
  const summary: AbandonReasonSummary[] = [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      percentage: Math.round((count / total) * 100),
      description: REASON_DESCRIPTIONS[reason] ?? reason,
    }))
    .sort((a, b) => b.count - a.count);

  return summary;
}

async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}
