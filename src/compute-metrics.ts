export function classifyCommits(
  commits: Array<{
    author: { login: string } | null;
    commit: { author: { date: string } | null };
  }>,
  prCreatedAt: string,
  aiLogins: string[]
): {
  copilotCommits: number;
  humanCommits: number;
  inheritedCommits: number;
  hadHumanPush: boolean;
  humanAuthors: string[];
} {
  const copilotLoginsSet = new Set(aiLogins.map((l) => l.toLowerCase()));
  const inheritedCutoff =
    new Date(prCreatedAt).getTime() - 5 * 60 * 1000;

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
    if (copilotLoginsSet.has(authorLogin)) {
      copilotCommits++;
    } else {
      humanCommits++;
      if (commit.author?.login) {
        humanAuthorSet.add(commit.author.login);
      }
    }
  }

  return {
    copilotCommits,
    humanCommits,
    inheritedCommits,
    hadHumanPush: humanCommits > 0,
    humanAuthors: [...humanAuthorSet],
  };
}

export function computeCostScore(params: {
  humanCommits: number;
  reviewRounds: number;
  reviewCommentCount: number;
  commentCount: number;
  abandoned: boolean;
}): number {
  const score =
    params.humanCommits * 3 +
    params.reviewRounds * 2 +
    params.reviewCommentCount * 0.3 +
    params.commentCount * 0.2 +
    (params.abandoned ? 5 : 0);
  return Math.round(score * 10) / 10;
}

export function computeTimeToMerge(
  createdAt: string,
  mergedAt: string | null
): number | null {
  if (mergedAt === null) return null;
  const days =
    (new Date(mergedAt).getTime() - new Date(createdAt).getTime()) /
    (1000 * 60 * 60 * 24);
  return Math.round(days * 10) / 10;
}

export function countReviewRounds(
  reviews: Array<{ state: string }>
): number {
  return reviews.filter((r) => r.state === "CHANGES_REQUESTED").length;
}
