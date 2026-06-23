// src/adapters/jira.ts
import { HttpError, type IssueTrackerAdapter, type AdapterAuthState, type Issue, type IssueStateType } from "./types";
import { extractIssueIdFromBranch } from "./linear";
import { buildIssuePrompt } from "./issue-prompt";
import { logError } from "../log";

// Fields requested on every issue read. We use REST API v2 (not v3) on purpose:
// v2 returns description and comment bodies as plain strings, whereas v3 returns
// Atlassian Document Format (a JSON tree) that would need a flattener. The Issue
// shape jmux uses is plain-text, so v2 is the natural fit.
const ISSUE_FIELDS = [
  "summary",
  "status",
  "assignee",
  "project",
  "priority",
  "updated",
  "description",
  "labels",
  "comment",
];

const STATUS_CATEGORY_TO_STATE: Record<string, IssueStateType> = {
  new: "unstarted",
  indeterminate: "started",
  done: "completed",
};

// Jira priority names → jmux's 0=none,1=urgent,2=high,3=medium,4=low scale.
const PRIORITY_NAME_TO_RANK: Record<string, number> = {
  highest: 1,
  high: 2,
  medium: 3,
  low: 4,
  lowest: 4,
};

/** Normalize a configured/env site URL to its bare origin (no trailing slash, no /rest suffix). */
export function normalizeJiraBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  url = url.replace(/\/rest(?:\/api\/\d+)?$/, "");
  return url;
}

export class JiraAdapter implements IssueTrackerAdapter {
  type = "jira";
  authState: AdapterAuthState = "unauthenticated";
  authHint = "$JIRA_BASE_URL + $JIRA_API_TOKEN (+ $JIRA_EMAIL for Basic auth)";

  private baseUrl: string | null;
  private email: string | null;
  private token: string | null = null;
  private readonly defaultIssueType: string;

  constructor(config: Record<string, unknown>) {
    const cfgUrl = typeof config.url === "string" ? config.url : null;
    this.baseUrl = cfgUrl ? normalizeJiraBaseUrl(cfgUrl) : null;
    this.email = typeof config.email === "string" ? config.email : null;
    this.defaultIssueType = typeof config.issueType === "string" ? config.issueType : "Task";
  }

  async authenticate(): Promise<void> {
    const url = this.baseUrl ?? process.env.JIRA_BASE_URL ?? process.env.JIRA_URL ?? null;
    const token = process.env.JIRA_API_TOKEN ?? process.env.JIRA_TOKEN ?? null;
    const email = this.email ?? process.env.JIRA_EMAIL ?? null;
    if (!url || !token) {
      this.authState = "failed";
      return;
    }
    this.baseUrl = normalizeJiraBaseUrl(url);
    this.token = token;
    this.email = email;
    this.authState = "ok";
  }

  // Jira's dev-panel (branch/PR) links are only exposed via a private, unstable
  // API, so reverse "MR → issue" lookup is not supported in v1. Branch-name
  // resolution (getIssueByBranch) remains the primary linking path.
  async getLinkedIssue(_mrUrl: string): Promise<Issue | null> {
    return null;
  }

  async getIssueByBranch(branch: string): Promise<Issue | null> {
    const key = extractIssueIdFromBranch(branch);
    if (!key) return null;
    try {
      const raw = await this.request("GET", `issue/${encodeURIComponent(key)}?fields=${ISSUE_FIELDS.join(",")}`);
      return raw ? this.mapIssue(raw) : null;
    } catch {
      return null;
    }
  }

  async pollIssue(issueId: string): Promise<Issue> {
    const raw = await this.request("GET", `issue/${encodeURIComponent(issueId)}?fields=${ISSUE_FIELDS.join(",")}`);
    if (!raw) throw new HttpError("Issue not found", 404);
    return this.mapIssue(raw);
  }

  async pollAllIssues(issueIds: string[]): Promise<Map<string, Issue>> {
    const result = new Map<string, Issue>();
    if (issueIds.length === 0) return result;
    const jql = `key IN (${issueIds.map((k) => `"${k.replace(/"/g, "")}"`).join(", ")})`;
    const issues = await this.searchJql(jql, issueIds.length);
    for (const issue of issues) result.set(issue.identifier, issue);
    return result;
  }

  async getAvailableStatuses(issueId: string): Promise<string[]> {
    if (this.authState !== "ok") return [];
    try {
      const transitions = await this.getTransitions(issueId);
      return transitions.map((t) => t.toName).filter((n): n is string => !!n);
    } catch {
      return [];
    }
  }

  openInBrowser(issueId: string): void {
    if (!this.baseUrl) return;
    const url = `${this.baseUrl}/browse/${encodeURIComponent(issueId)}`;
    Bun.spawn(["open", url], { stdout: "ignore", stderr: "ignore" });
  }

  async updateStatus(issueId: string, status: string): Promise<void> {
    try {
      const transitions = await this.getTransitions(issueId);
      const target = transitions.find(
        (t) => t.toName && t.toName.trim().toLowerCase() === status.trim().toLowerCase(),
      );
      if (!target) {
        // No single-hop transition reaches the requested status. Jira workflows
        // only expose transitions valid from the current status, so this happens
        // when advancing across a gap. Log rather than throw — mirrors Linear's
        // silent no-op when a target state can't be resolved.
        logError("Jira", `no transition to status "${status}" available for ${issueId}`);
        return;
      }
      await this.request("POST", `issue/${encodeURIComponent(issueId)}/transitions`, {
        transition: { id: target.id },
      });
    } catch (e) {
      logError("Jira", `updateStatus failed for ${issueId}: ${(e as Error).message}`);
    }
  }

  async createIssue(teamId: string, title: string, description: string): Promise<Issue> {
    const body = {
      fields: {
        project: { key: teamId },
        summary: title,
        description: description || undefined,
        issuetype: { name: this.defaultIssueType },
      },
    };
    const created = await this.request("POST", "issue", body);
    const key = created?.key;
    if (!key) throw new Error("Failed to create issue");
    // Re-read so the returned Issue carries the full, server-resolved fields.
    try {
      return await this.pollIssue(key);
    } catch {
      return {
        id: key,
        identifier: key,
        title,
        status: "Unknown",
        assignee: null,
        linkedMrUrls: [],
        webUrl: this.baseUrl ? `${this.baseUrl}/browse/${key}` : "",
        description: description || undefined,
      };
    }
  }

  async searchIssues(query: string): Promise<Issue[]> {
    if (this.authState !== "ok") return [];
    const escaped = query.replace(/["\\]/g, "\\$&");
    const jql = `text ~ "${escaped}" ORDER BY updated DESC`;
    try {
      return await this.searchJql(jql, 20);
    } catch {
      return [];
    }
  }

  async getMyIssues(): Promise<Issue[]> {
    if (this.authState !== "ok") return [];
    const jql = `assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC`;
    try {
      return await this.searchJql(jql, 100);
    } catch {
      return [];
    }
  }

  async getTeams(): Promise<Array<{ id: string; name: string }>> {
    // Jira has no "teams"; projects are the closest equivalent. The project key
    // is used as the id so createIssue() can address the project directly, while
    // the human-readable name drives panel grouping and teamRepoMap keys.
    if (this.authState !== "ok") return [];
    try {
      const resp = await this.request("GET", "project/search?maxResults=50");
      const values = (resp?.values ?? []) as Array<{ key?: string; name?: string }>;
      return values
        .filter((p) => p.key)
        .map((p) => ({ id: p.key as string, name: p.name ?? (p.key as string) }));
    } catch {
      return [];
    }
  }

  buildPrompt(issue: Issue): string {
    return buildIssuePrompt(issue, "Jira");
  }

  // --- internals -------------------------------------------------------------

  private async getTransitions(issueId: string): Promise<Array<{ id: string; toName?: string }>> {
    const resp = await this.request("GET", `issue/${encodeURIComponent(issueId)}/transitions`);
    const transitions = (resp?.transitions ?? []) as Array<{ id: string; to?: { name?: string } }>;
    return transitions.map((t) => ({ id: t.id, toName: t.to?.name }));
  }

  /**
   * Bounded JQL search via the current `POST /rest/api/2/search/jql` endpoint
   * (the legacy `/search` was deprecated by Atlassian in 2025).
   */
  private async searchJql(jql: string, maxResults: number): Promise<Issue[]> {
    const resp = await this.request("POST", "search/jql", {
      jql,
      fields: ISSUE_FIELDS,
      maxResults,
    });
    const issues = (resp?.issues ?? []) as any[];
    return issues.map((n) => this.mapIssue(n));
  }

  private mapIssue(raw: any): Issue {
    const f = raw.fields ?? {};
    const key = raw.key ?? "";
    const categoryKey = f.status?.statusCategory?.key as string | undefined;
    const priorityName = (f.priority?.name as string | undefined)?.toLowerCase();
    return {
      id: key,
      identifier: key,
      title: f.summary ?? "",
      status: f.status?.name ?? "Unknown",
      stateType: categoryKey ? STATUS_CATEGORY_TO_STATE[categoryKey] : undefined,
      assignee: f.assignee?.displayName ?? null,
      // Jira dev-link MR URLs aren't available via the public API (see getLinkedIssue).
      linkedMrUrls: [],
      webUrl: this.baseUrl ? `${this.baseUrl}/browse/${key}` : "",
      team: f.project?.name ?? undefined,
      priority: priorityName && priorityName in PRIORITY_NAME_TO_RANK ? PRIORITY_NAME_TO_RANK[priorityName] : undefined,
      updatedAt: f.updated ? new Date(f.updated).getTime() : undefined,
      description: typeof f.description === "string" && f.description.length > 0 ? f.description : undefined,
      labels: Array.isArray(f.labels)
        ? f.labels.filter((l: unknown): l is string => typeof l === "string").map((name: string) => ({ name }))
        : [],
      comments: (f.comment?.comments ?? []).map((c: any) => ({
        id: c.id ?? undefined,
        author: c.author?.displayName ?? "Unknown",
        body: typeof c.body === "string" ? c.body : "",
        createdAt: c.created ?? "",
      })),
    };
  }

  private authHeader(): string {
    if (this.email) {
      // Jira Cloud personal API tokens use Basic auth with the account email.
      return `Basic ${Buffer.from(`${this.email}:${this.token}`).toString("base64")}`;
    }
    // No email configured → treat the token as an OAuth 2.0 / bearer token.
    return `Bearer ${this.token}`;
  }

  private async request(method: string, path: string, body?: unknown): Promise<any | null> {
    if (!this.baseUrl) throw new HttpError("Jira base URL not configured", 0);
    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const resp = await fetch(`${this.baseUrl}/rest/api/2/${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) this.authState = "failed";
      throw new HttpError(`Jira API error: ${resp.status}`, resp.status);
    }
    // Transitions POST (and some others) return 204 No Content.
    if (resp.status === 204) return null;
    const text = await resp.text();
    return text.length > 0 ? JSON.parse(text) : null;
  }
}
