// src/__tests__/adapters/jira.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { JiraAdapter, normalizeJiraBaseUrl } from "../../adapters/jira";

const ENV_KEYS = ["JIRA_BASE_URL", "JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN", "JIRA_TOKEN"] as const;

describe("normalizeJiraBaseUrl", () => {
  test("strips trailing slashes", () => {
    expect(normalizeJiraBaseUrl("https://acme.atlassian.net/")).toBe("https://acme.atlassian.net");
  });

  test("strips a /rest/api/2 suffix", () => {
    expect(normalizeJiraBaseUrl("https://acme.atlassian.net/rest/api/2")).toBe("https://acme.atlassian.net");
  });

  test("strips a bare /rest suffix", () => {
    expect(normalizeJiraBaseUrl("https://acme.atlassian.net/rest")).toBe("https://acme.atlassian.net");
  });

  test("leaves a clean origin untouched", () => {
    expect(normalizeJiraBaseUrl("https://acme.atlassian.net")).toBe("https://acme.atlassian.net");
  });
});

describe("JiraAdapter", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("starts in unauthenticated state", () => {
    const adapter = new JiraAdapter({ type: "jira" });
    expect(adapter.type).toBe("jira");
    expect(adapter.authState).toBe("unauthenticated");
    expect(adapter.authHint).toContain("JIRA_API_TOKEN");
  });

  test("authenticate fails without a base URL", async () => {
    process.env.JIRA_API_TOKEN = "tok";
    const adapter = new JiraAdapter({ type: "jira" });
    await adapter.authenticate();
    expect(adapter.authState).toBe("failed");
  });

  test("authenticate fails without a token", async () => {
    process.env.JIRA_BASE_URL = "https://acme.atlassian.net";
    const adapter = new JiraAdapter({ type: "jira" });
    await adapter.authenticate();
    expect(adapter.authState).toBe("failed");
  });

  test("authenticate succeeds with base URL + token from env (bearer)", async () => {
    process.env.JIRA_BASE_URL = "https://acme.atlassian.net";
    process.env.JIRA_API_TOKEN = "tok";
    const adapter = new JiraAdapter({ type: "jira" });
    await adapter.authenticate();
    expect(adapter.authState).toBe("ok");
  });

  test("authenticate succeeds with email + token (basic)", async () => {
    process.env.JIRA_BASE_URL = "https://acme.atlassian.net";
    process.env.JIRA_EMAIL = "dev@acme.com";
    process.env.JIRA_API_TOKEN = "tok";
    const adapter = new JiraAdapter({ type: "jira" });
    await adapter.authenticate();
    expect(adapter.authState).toBe("ok");
  });

  test("config url is honored without env vars", async () => {
    process.env.JIRA_API_TOKEN = "tok";
    const adapter = new JiraAdapter({ type: "jira", url: "https://acme.atlassian.net/" });
    await adapter.authenticate();
    expect(adapter.authState).toBe("ok");
  });

  test("getLinkedIssue returns null (Jira dev-link reverse lookup unsupported)", async () => {
    const adapter = new JiraAdapter({ type: "jira" });
    expect(await adapter.getLinkedIssue("https://gitlab.com/x/y/-/merge_requests/1")).toBeNull();
  });

  test("read methods return empty when unauthenticated", async () => {
    const adapter = new JiraAdapter({ type: "jira" });
    expect(await adapter.searchIssues("test")).toEqual([]);
    expect(await adapter.getMyIssues()).toEqual([]);
    expect(await adapter.getTeams()).toEqual([]);
    expect(await adapter.getAvailableStatuses("PROJ-1")).toEqual([]);
    expect(await adapter.pollAllIssues([])).toEqual(new Map());
  });
});
