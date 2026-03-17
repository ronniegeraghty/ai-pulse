import "dotenv/config";
import type { CollectionConfig } from "./types.js";

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val || val.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val.trim();
}

function isValidDate(dateStr: string): boolean {
  const d = new Date(dateStr);
  return !isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

export function loadConfig(): CollectionConfig {
  // Repos
  const reposRaw = requireEnv("AI_PULSE_REPOS");
  const repos = reposRaw.split(",").map(r => r.trim()).filter(Boolean);
  for (const repo of repos) {
    const parts = repo.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid repo format: "${repo}". Expected "owner/repo".`);
    }
  }
  if (repos.length === 0) {
    throw new Error("AI_PULSE_REPOS must contain at least one repo.");
  }

  // Dates
  const startDate = requireEnv("AI_PULSE_START_DATE");
  const endDate = requireEnv("AI_PULSE_END_DATE");
  if (!isValidDate(startDate)) throw new Error(`Invalid AI_PULSE_START_DATE: "${startDate}". Use YYYY-MM-DD.`);
  if (!isValidDate(endDate)) throw new Error(`Invalid AI_PULSE_END_DATE: "${endDate}". Use YYYY-MM-DD.`);
  if (new Date(startDate) > new Date(endDate)) {
    throw new Error(`AI_PULSE_START_DATE (${startDate}) must be ≤ AI_PULSE_END_DATE (${endDate}).`);
  }

  // Labels (optional)
  const labelsRaw = process.env.AI_PULSE_LABELS ?? "";
  const labels = labelsRaw.split(",").map(l => l.trim()).filter(Boolean);

  // AI logins (optional, with defaults)
  const aiLoginsRaw = process.env.AI_PULSE_AI_LOGINS ?? "copilot,copilot[bot]";
  const aiLogins = aiLoginsRaw.split(",").map(l => l.trim()).filter(Boolean);

  // Inactive days (optional, default 14)
  const inactiveDaysRaw = process.env.AI_PULSE_INACTIVE_DAYS ?? "14";
  const inactiveDays = parseInt(inactiveDaysRaw, 10);
  if (isNaN(inactiveDays) || inactiveDays <= 0) {
    throw new Error(`Invalid AI_PULSE_INACTIVE_DAYS: "${inactiveDaysRaw}". Must be a positive integer.`);
  }

  return { repos, startDate, endDate, labels, aiLogins, inactiveDays };
}
