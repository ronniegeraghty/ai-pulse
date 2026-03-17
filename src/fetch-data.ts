import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "./config.js";
import { createOctokit, logRateLimit } from "./github-client.js";
import { findCopilotPRNumbers, fetchPRDetails } from "./fetch-prs.js";
import { classifyAbandonedPRs } from "./classify-abandon.js";
import type { OutputData } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

async function main() {
  // 1. Load config
  const config = loadConfig();
  console.log(`\nAI Pulse — Data Collection`);
  console.log(`Repos: ${config.repos.join(", ")}`);
  console.log(`Date range: ${config.startDate} → ${config.endDate}`);
  if (config.labels.length > 0) {
    console.log(`Label filter: ${config.labels.join(", ")}`);
  }

  // 2. Create Octokit and log rate limit
  const octokit = createOctokit();
  await logRateLimit(octokit);

  // 3. Process each repo
  const output: OutputData = {
    generatedAt: new Date().toISOString(),
    config,
    repos: {},
  };

  for (const repoFullName of config.repos) {
    const [owner, repo] = repoFullName.split("/");
    console.log(`\nProcessing ${owner}/${repo}...`);

    // Find Copilot PRs
    const prNumbers = await findCopilotPRNumbers(octokit, owner, repo, config);

    // Fetch details
    const prs = await fetchPRDetails(octokit, owner, repo, prNumbers, config);

    // Classify abandoned PRs
    const abandonReasons = await classifyAbandonedPRs(octokit, owner, repo, prs, config.aiLogins);

    // Store results
    output.repos[repoFullName] = { prs, abandonReasons };

    // Summary
    const merged = prs.filter(p => p.state === "merged").length;
    const abandoned = prs.filter(p => p.state === "abandoned").length;
    const humanPush = prs.filter(p => p.hadHumanPush).length;
    console.log(`  Total: ${prs.length} Copilot PRs (${merged} merged, ${abandoned} abandoned)`);
    if (prs.length > 0) {
      console.log(`  Human intervention: ${humanPush} PRs (${((humanPush / prs.length) * 100).toFixed(1)}%) had human commits`);
    } else {
      console.log(`  Human intervention: 0 PRs (no PRs found in date range)`);
    }
  }

  // 4. Write output
  mkdirSync(DATA_DIR, { recursive: true });
  const outputPath = join(DATA_DIR, "pr-stats.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nData written to ${outputPath}`);

  // Final summary
  console.log(`\n--- Summary ---`);
  for (const [repoName, repoData] of Object.entries(output.repos)) {
    const merged = repoData.prs.filter(p => p.state === "merged").length;
    const abandoned = repoData.prs.filter(p => p.state === "abandoned").length;
    console.log(`${repoName}: ${repoData.prs.length} PRs (${merged} merged, ${abandoned} abandoned)`);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
