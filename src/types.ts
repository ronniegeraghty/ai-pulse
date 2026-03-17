export interface PRData {
  // Identity
  number: number;
  title: string;
  url: string;
  author: string;
  repo: string;

  // State
  state: "merged" | "abandoned";
  labels: string[];

  // Timestamps
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  updatedAt: string;

  // Time metrics
  timeToMergeDays: number | null;

  // Comment metrics
  commentCount: number;
  reviewCommentCount: number;

  // Commit analysis
  totalCommits: number;
  copilotCommits: number;
  humanCommits: number;
  inheritedCommits: number;
  hadHumanPush: boolean;
  humanAuthors: string[];

  // Review analysis
  reviewRounds: number;

  // Cost score
  costScore: number;

  // Abandon analysis
  abandonReason?: string;
  supersededBy?: {
    number: number;
    title: string;
    author: string;
  } | null;
}

export interface AbandonReasonSummary {
  reason: string;
  count: number;
  percentage: number;
  description: string;
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
  generatedAt: string;
  config: CollectionConfig;
  repos: Record<string, RepoData>;
}
