import { Octokit } from "@octokit/rest";
import { execSync } from "child_process";

function getToken(): string {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  try {
    return execSync("gh auth token", { encoding: "utf-8" }).trim();
  } catch {
    console.error("No GITHUB_TOKEN env var and `gh auth token` failed. Please authenticate.");
    process.exit(1);
  }
}

export function createOctokit(): Octokit {
  const token = getToken();
  return new Octokit({ auth: token });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 5000
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i === retries - 1) throw err;

      const status = err?.status ?? err?.response?.status;

      // Rate limit hit (403 with remaining=0) — wait for reset
      if (status === 403 && err?.response?.headers?.["x-ratelimit-remaining"] === "0") {
        const resetAt = parseInt(err.response.headers["x-ratelimit-reset"] ?? "0") * 1000;
        const waitMs = Math.max(1000, resetAt - Date.now() + 1000);
        console.log(`  Rate limit hit, waiting ${Math.ceil(waitMs / 1000)}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      // Non-retryable client errors (except 403 which could be rate limit)
      if (status && status >= 400 && status < 500 && status !== 403) {
        throw err;
      }

      // Server errors or network errors — exponential backoff
      console.log(`  Retrying after error (attempt ${i + 2}/${retries})...`);
      await new Promise(r => setTimeout(r, delay * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

export async function logRateLimit(octokit: Octokit): Promise<void> {
  const { data: rateLimit } = await octokit.rateLimit.get();
  console.log(
    `GitHub API rate limit: ${rateLimit.rate.remaining}/${rateLimit.rate.limit} ` +
    `(resets at ${new Date(rateLimit.rate.reset * 1000).toISOString()})`
  );
}
