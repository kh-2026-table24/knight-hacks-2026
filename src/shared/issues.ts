/**
 * A problem found in a GameSpec. Messages are written for Claude to act on (what is wrong, then how to
 * fix it) and name the exact place, so they can go straight into a repair prompt.
 */
export interface Issue {
  severity: "error" | "warning";
  /** Set for problems inside one room, so generation can ask Claude to redo just that room. */
  room?: string;
  /** Where in the JSON, e.g. rooms[2](study).props[3](oak-desk).parts[1].size */
  path: string;
  message: string;
}

export const errorsIn = (issues: Issue[]) => issues.filter((issue) => issue.severity === "error");

/** A bulleted list, for repair prompts, server errors, logs and the client's error overlay. */
export function formatIssues(issues: Issue[]) {
  return issues.map((issue) => `- ${issue.severity === "warning" ? "(warning) " : ""}${issue.message}`).join("\n");
}
