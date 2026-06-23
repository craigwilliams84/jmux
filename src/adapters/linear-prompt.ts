import type { Issue } from "./types";
import { buildIssuePrompt } from "./issue-prompt";

export function buildLinearPrompt(issue: Issue): string {
  return buildIssuePrompt(issue, "Linear");
}
