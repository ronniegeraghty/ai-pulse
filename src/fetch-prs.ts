import type { Octokit } from "@octokit/rest";
import type { CollectionConfig, PRData } from "./types.js";
import { withRetry } from "./github-client.js";

/**
 * Search GitHub for PRs authored by copilot across 3 state filters,
 * with date range and pagination. Returns a Set of PR numbers.
 */
export async function findCopilotPRNumbers(
  octokit: Octokit,
  owner: string,
  repo: string,
  config: CollectionConfig
): Promise<Set<number>> {
  const prNumbers = new Set<number>();

  console.log(`Searching for PRs authored by @copilot in ${owner}/${repo}...`);

  for (const stateFilter of ["is:merged", "is:unmerged", "is:open"]) {
    const q = `is:pr author:app/copilot ${stateFilter} repo:${owner}/${repo} created:${config.startDate}..${config.endDate}`;
    let page = 1;
    let totalCount = 0;

    while (page <= 10) {
      const res = await withRetry(() =>
        octokit.rest.search.issuesAndPullRequests({
          q,
          per_page: 100,
          page,
        })
      );

      const items = res.data.items;
      for (const item of items) {
        prNumbers.add(item.number);
      }

      totalCount += items.length;
      console.log(
        `  Search ${stateFilter} page ${page}: ${items.length} PRs (total: ${totalCount})`
      );

      if (items.length < 100) break;
      page++;
    }
  }

  console.log(`Found ${prNumbers.size} unique Copilot PRs in ${owner}/${repo}`);
  return prNumbers;
}

/**
 * Fetch full PR details for each PR number. Processes 10 PRs at a time.
 * Classifies state, filters by labels, computes commit analysis, cost score,
 * and time-to-merge. Returns PRData[] sorted by createdAt ascending.
 */
export async function fetchPRDetails(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumbers: Set<number>,
  config: CollectionConfig
): Promise<PRData[]> {
  const prList = Array.from(prNumbers);
  const results: PRData[] = [];
  const aiLogins = new Set(config.aiLogins.map((l) => l.toLowerCase()));
  const CONCURRENCY = 10;
  let completed = 0;

  for (let i = 0; i < prList.length; i += CONCURRENCY) {
    const batch = prList.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(async (prNumber) => {
        const [prRes, commitsRes, reviewsRes] = await Promise.all([
          withRetry(() =>
            octokit.pulls.get({ owner, repo, pull_number: prNumber })
          ),
          withRetry(() =>
            octokit.pulls.listCommits({
              owner,
              repo,
              pull_number: prNumber,
              per_page: 100,
            })
          ),
          withRetry(() =>
            octokit.pulls.listReviews({
              owner,
              repo,
              pull_number: prNumber,
              per_page: 100,
            })
          ),
        ]);

        const pr = prRes.data;
        const commits = commitsRes.data;
        const reviews = reviewsRes.data;

        // --- State classification ---
        let state: "merged" | "abandoned" | null;
        if (pr.merged_at) {
          state = "merged";
        } else if (pr.state === "closed") {
          state = "abandoned";
        } else if (pr.state === "open") {
          const msSinceUpdate =
            Date.now() - new Date(pr.updated_at).getTime();
          const inactiveThresholdMs =
            config.inactiveDays * 24 * 60 * 60 * 1000;
          if (msSinceUpdate >= inactiveThresholdMs) {
            state = "abandoned";
          } else {
            // Still active — skip
            return null;
          }
        } else {
          return null;
        }

        // --- Label filtering ---
        if (config.labels.length > 0) {
          const prLabels = pr.labels.map((l) =>
            (typeof l === "string" ? l : l.name ?? "").toLowerCase()
          );
          const hasMatchingLabel = config.labels.some((configLabel) =>
            prLabels.includes(configLabel.toLowerCase())
          );
          if (!hasMatchingLabel) return null;
        }

        // --- Commit classification ---
        const prCreatedAt = new Date(pr.created_at).getTime();
        const inheritedCutoff = prCreatedAt - 5 * 60 * 1000;
        let copilotCommits = 0;
        let humanCommits = 0;
        let inheritedCommits = 0;
        const humanAuthorSet = new Set<string>();

        for (const commit of commits) {
          const commitDate = new Date(
            commit.commit.author?.date ?? 0
          ).getTime();

          if (commitDate < inheritedCutoff) {
            inheritedCommits++;
            continue;
          }

          const authorLogin = (commit.author?.login ?? "").toLowerCase();
          if (aiLogins.has(authorLogin)) {
            copilotCommits++;
          } else {
            humanCommits++;
            if (commit.author?.login) {
              humanAuthorSet.add(commit.author.login);
            }
          }
        }

        const hadHumanPush = humanCommits > 0;

        // --- Review rounds ---
        const reviewRounds = reviews.filter(
          (r) => r.state === "CHANGES_REQUESTED"
        ).length;

        // --- Cost score ---
        const abandoned = state === "abandoned";
        const commentCount = pr.comments;
        const reviewCommentCount = pr.review_comments;
        const costScore =
          Math.round(
            (humanCommits * 3 +
              reviewRounds * 2 +
              reviewCommentCount * 0.3 +
              commentCount * 0.2 +
              (abandoned ? 5 : 0)) *
              10
          ) / 10;

        // --- Time to merge ---
        let timeToMergeDays: number | null = null;
        if (pr.merged_at) {
          const createdMs = new Date(pr.created_at).getTime();
          const mergedMs = new Date(pr.merged_at).getTime();
          timeToMergeDays =
            Math.round(((mergedMs - createdMs) / (1000 * 60 * 60 * 24)) * 10) /
            10;
        }

        // --- Labels ---
        const labels = pr.labels.map((l) =>
          typeof l === "string" ? l : l.name ?? ""
        );

        // --- Build PRData ---
        const prData: PRData = {
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          author: pr.user?.login ?? "unknown",
          repo: `${owner}/${repo}`,
          state,
          labels,
          createdAt: pr.created_at,
          closedAt: pr.closed_at ?? null,
          mergedAt: pr.merged_at ?? null,
          updatedAt: pr.updated_at,
          timeToMergeDays,
          commentCount,
          reviewCommentCount,
          totalCommits: commits.length,
          copilotCommits,
          humanCommits,
          inheritedCommits,
          hadHumanPush,
          humanAuthors: Array.from(humanAuthorSet),
          reviewRounds,
          costScore,
        };

        return prData;
      })
    );

    for (const result of batchResults) {
      completed++;
      if (result.status === "fulfilled" && result.value !== null) {
        results.push(result.value);
      } else if (result.status === "rejected") {
        console.error(`  Failed to fetch PR: ${result.reason}`);
      }
    }

    console.log(`Fetched ${completed}/${prList.length} PRs`);
  }

  // Sort by createdAt ascending
  results.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return results;
}
