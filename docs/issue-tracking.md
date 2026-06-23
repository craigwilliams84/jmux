# Issue Tracking & MR Integration

jmux connects to your issue tracker and code host to show issues, merge requests, and pipeline status directly in the terminal. No browser tab required for triage, status updates, or MR approvals.

Currently supported: **Linear** and **Jira** (issue tracking), and **GitLab** / **GitHub** (code host / MRs).

---

## Quick Setup

### 1. Set environment variables

```bash
# Linear — either one works
export LINEAR_API_KEY="lin_api_..."
# or
export LINEAR_TOKEN="lin_api_..."

# Jira (Cloud) — site URL + API token; email enables Basic auth (the usual
# personal-token flow). Without an email the token is sent as a Bearer token.
export JIRA_BASE_URL="https://yourcompany.atlassian.net"
export JIRA_API_TOKEN="ATATT..."
export JIRA_EMAIL="you@yourcompany.com"   # optional (Basic auth)

# GitLab — any of these, or glab CLI auth
export GITLAB_TOKEN="glpat-..."
# or
export GITLAB_PRIVATE_TOKEN="glpat-..."
```

### 2. Configure adapters

Add to `~/.config/jmux/config.json` (or press `Ctrl-a i` and navigate to **Integrations**):

```json
{
  "adapters": {
    "codeHost": { "type": "gitlab" },
    "issueTracker": { "type": "linear" }
  }
}
```

For Jira, set the issue tracker to `jira`. The site URL can live in config instead of the `JIRA_BASE_URL` env var:

```json
{
  "adapters": {
    "issueTracker": { "type": "jira", "url": "https://yourcompany.atlassian.net" }
  }
}
```

Optional Jira adapter fields: `email` (alternative to `$JIRA_EMAIL`) and `issueType` (issue type used by *New Issue*, default `"Task"`).

### 3. Restart jmux

Adapters authenticate on startup. If auth fails, jmux runs normally without the integration — the panel tabs just won't populate.

---

## The Info Panel

Press `Ctrl-a g` to toggle the info panel. It docks to the right side of the terminal with tabbed views:

| Tab | What it shows |
|-----|---------------|
| **Diff** | hunk diff viewer (same as before — this was the original panel) |
| **Issues** | Your assigned issues from Linear, grouped by team and status |
| **MRs** | Merge requests you authored, with pipeline and approval status |
| **Review** | MRs awaiting your review |

Click the panel or press `Shift-Right` to focus it. Use `[` and `]` to cycle between tabs.

### Navigation

| Key | Action |
|-----|--------|
| `[` / `]` | Cycle tabs |
| `↑` / `↓` | Move selection through items |
| `Enter` | Collapse/expand group headers |
| Mouse wheel | Scroll item list or detail pane |
| Click item | Select it |

### Actions

**On an issue:**

| Key | Action |
|-----|--------|
| `o` | Open in browser |
| `n` | Create a new session from this issue |
| `l` | Link this issue to the current session |
| `s` | Update status — shows your configured progression if set, otherwise the tracker's available states |
| `>` | Advance one stage along the configured progression (see below) |
| `c` | Copy issue prompt to clipboard (identifier + title + description) |

**On a merge request:**

| Key | Action |
|-----|--------|
| `o` | Open in browser |
| `l` | Link this MR to the current session |
| `a` | Approve the MR |
| `r` | Mark ready (remove Draft prefix) |

### View customization

While focused on an issue or MR tab, you can cycle the view's grouping and sorting:

| Key | Action |
|-----|--------|
| `g` | Cycle group-by: team, project, status, priority, none |
| `G` | Cycle sub-group-by: same options |
| `/` | Cycle sort: priority, updated, created, status |
| `?` | Toggle sort order: ascending / descending |

Changes persist to `~/.config/jmux/config.json` automatically.

---

## Session Linking

jmux automatically links sessions to their issues and MRs using multiple signals:

1. **Branch name** — if your branch is `eng-1234-fix-auth`, jmux finds the Linear issue `ENG-1234`
2. **MR source branch** — the session's git branch is matched to an open MR
3. **MR-to-issue links** — if the MR links to a Linear issue (via Linear attachments), jmux follows it
4. **Transitive links** — if an issue has MR URLs in its attachments, jmux resolves those too
5. **Manual links** — press `l` in the panel or use the command palette to explicitly link items

Linked items show in the sidebar on a third row beneath the branch name:

```
  ● api-server        ✓  3w
    feature-auth
    ENG-1234           1M
```

The `✓` is the pipeline status glyph, `ENG-1234` is the linked issue, and `1M` means one linked merge request.

### Manual linking from the command palette

Press `Ctrl-a p` and search for:
- **"Link issue"** — fuzzy search Linear issues and link one to the current session
- **"Link MR"** — fuzzy search MRs and link one to the current session
- **"Unlink issue"** / **"Unlink MR"** — remove a manual link

Manual links are stored in `~/.config/jmux/state.json` and survive restarts.

---

## Issue-to-Session Workflow

The most powerful feature: select an issue in the panel and press `n` to create a fully provisioned session.

### What happens

1. jmux looks up the issue's team in your `teamRepoMap` config to find the repository
2. Creates a git worktree (or branch) from your configured base branch
3. Creates a new tmux session in that worktree
4. Links the session to the issue
5. Optionally launches Claude Code with the issue's title and description as context

### Configuration

```json
{
  "issueWorkflow": {
    "teamRepoMap": {
      "Platform": "~/repos/backend",
      "Frontend": "~/repos/frontend",
      "Mobile": "~/repos/mobile-app"
    },
    "defaultBaseBranch": "main",
    "autoCreateWorktree": true,
    "autoLaunchAgent": true,
    "sessionNameTemplate": "{identifier}",
    "statusProgression": ["Ready for Developer", "In Development", "In Review", "Ready for Test"]
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `teamRepoMap` | `{}` | Maps issue tracker team/project names to local repo directories |
| `defaultBaseBranch` | `"main"` | Branch to create worktrees from |
| `autoCreateWorktree` | `true` | Create a git worktree automatically |
| `autoLaunchAgent` | `true` | Launch Claude Code with issue context |
| `sessionNameTemplate` | `"{identifier}"` | Template for session names. Supports `{identifier}` and `{title}` |
| `statusProgression` | `[]` | Ordered status names for manual advance (see [Status Progression](#status-progression)) |

### Team-to-repo mapping

The `teamRepoMap` is what enables the automated flow. Without it, pressing `n` on an issue opens the standard new-session modal where you pick a directory manually.

Configure it in settings (`Ctrl-a i` > **Issue Workflow** > **Team -> repo mappings**) or edit the config file directly. The inline picker shows your project directories for quick selection.

### Three-state workflow

Issues in the panel show their session state:

| State | Meaning | Action on `n` |
|-------|---------|---------------|
| No session | No worktree or session exists | Creates worktree + session + launches agent |
| Worktree exists | Worktree on disk but no tmux session | Creates session in existing worktree |
| Session exists | Tmux session is running | Switches to that session |

---

## Status Progression

Most teams move tickets through a fixed workflow. Configure that flow once and step tickets through it without leaving the panel:

```json
{
  "issueWorkflow": {
    "statusProgression": ["Ready for Developer", "In Development", "In Review", "Ready for Test"]
  }
}
```

Set it in the settings screen (`Ctrl-a i` > **Issue Workflow** > **Status progression**) as a comma-separated list, or edit the config directly.

With a progression configured:

- **`>` — advance** moves the selected issue to the **next** stage after its current status. If the issue's status isn't in the list, or it's already at the last stage, `>` does nothing.
- **`s` — set status** shows your configured stages (instead of the tracker's raw state list), so you can jump to any stage in the flow.

Status changes apply optimistically in the panel and reconcile on the next poll.

**Jira note:** Jira changes status via *transitions*, not by setting a status directly. jmux resolves your target status name to the matching transition automatically. Because Jira only exposes transitions valid from the current status, an advance must be a single hop your workflow actually permits — list your stages in the order your Jira board transitions through them. If no transition to the next stage exists, jmux logs it and leaves the status unchanged.

---

## Polling & Rate Limits

jmux polls adapters on a tiered schedule to stay responsive without hammering APIs:

| Tier | Interval | What's polled |
|------|----------|---------------|
| Active session | 20 seconds | MRs and issues linked to the focused session |
| Background sessions | 3 minutes | MRs and issues for all other sessions |
| Global data | 5 minutes | Your full issue list and MR lists |

If jmux detects a rate limit (HTTP 429), it backs off:
- Active polling slows to 60 seconds
- Background and global polling pause entirely
- Normal polling resumes automatically when the limit clears

Auth failures (401/403) disable the affected adapter until jmux restarts.

---

## Pipeline Status

When a session has a linked MR with a CI pipeline, the sidebar shows a glyph:

| Glyph | Color | Meaning |
|-------|-------|---------|
| `✓` | Green | Pipeline passed |
| `⟳` | Yellow | Pipeline running |
| `✗` | Red | Pipeline failed |
| `◆` | Purple | MR merged |
| `—` | Dim | Pipeline canceled |

If a session has multiple MRs, the worst status wins (failed > running > pending > passed).

---

## Custom Panel Views

The default tabs (Issues, MRs, Review) can be customized via `panelViews` in config:

```json
{
  "panelViews": [
    {
      "id": "my-issues",
      "label": "Issues",
      "source": "issues",
      "filter": { "scope": "assigned" },
      "groupBy": "team",
      "subGroupBy": "status",
      "sortBy": "priority",
      "sortOrder": "asc",
      "sessionLinkedFirst": true
    },
    {
      "id": "my-mrs",
      "label": "MRs",
      "source": "mrs",
      "filter": { "scope": "authored" },
      "groupBy": "none",
      "sortBy": "updated",
      "sortOrder": "desc"
    },
    {
      "id": "review",
      "label": "Review",
      "source": "mrs",
      "filter": { "scope": "reviewing" },
      "groupBy": "none",
      "sortBy": "updated",
      "sortOrder": "desc"
    }
  ]
}
```

**View options:**

| Field | Values | Description |
|-------|--------|-------------|
| `source` | `"issues"`, `"mrs"` | Data source |
| `filter.scope` | `"assigned"`, `"authored"`, `"reviewing"` | Which items to show |
| `groupBy` | `"team"`, `"project"`, `"status"`, `"priority"`, `"none"` | Primary grouping |
| `subGroupBy` | Same as `groupBy` | Secondary grouping within groups |
| `sortBy` | `"priority"`, `"updated"`, `"created"`, `"status"` | Sort field |
| `sortOrder` | `"asc"`, `"desc"` | Sort direction |
| `sessionLinkedFirst` | `true`, `false` | Float items linked to the current session to the top |

---

## Authentication

### Linear

Set one of these environment variables:

| Variable | Description |
|----------|-------------|
| `LINEAR_API_KEY` | Personal API key from Linear Settings > API |
| `LINEAR_TOKEN` | Same — either name works |

Generate a key at [linear.app/settings/api](https://linear.app/settings/api).

### Jira (Cloud)

| Variable | Description |
|----------|-------------|
| `JIRA_BASE_URL` | Your site, e.g. `https://yourcompany.atlassian.net` (or set `url` in the adapter config). `JIRA_URL` also works. |
| `JIRA_API_TOKEN` | API token from [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens). `JIRA_TOKEN` also works. |
| `JIRA_EMAIL` | Your Atlassian account email. Optional — see auth modes below. |

**Auth modes:**

- **Basic (recommended for personal tokens):** set `JIRA_EMAIL`. jmux sends `Authorization: Basic base64(email:token)` — the standard flow for Jira Cloud personal API tokens.
- **Bearer:** leave the email unset and jmux sends `Authorization: Bearer <token>`. Use this if your token is an OAuth 2.0 access token.

Jira has no concept of *teams* — projects fill that role. `getTeams`, the **Issues** panel grouping, *New Issue*, and `teamRepoMap` keys all use Jira **project names**. Jira also returns issue descriptions and comments as plain text (jmux uses REST API v2), and dev-panel branch/PR links aren't exposed by the public API, so session↔issue linking relies on branch names (e.g. `PROJ-123-fix-thing`) rather than MR-to-issue links.

### GitLab

Set one of these, or authenticate via `glab`:

| Variable | Description |
|----------|-------------|
| `GITLAB_TOKEN` | Personal access token with `api` scope |
| `GITLAB_PRIVATE_TOKEN` | Same — either name works |
| `GITLAB_PERSONAL_ACCESS_TOKEN` | Same — either name works |

If no env var is set, jmux falls back to `glab auth status` to extract a token from the GitLab CLI.

For self-hosted GitLab, add a `url` field to the adapter config:

```json
{
  "adapters": {
    "codeHost": {
      "type": "gitlab",
      "url": "https://gitlab.yourcompany.com/api/v4"
    }
  }
}
```

### Auth status

The sidebar and panel show auth state. If authentication fails, jmux logs the error and continues without the integration. Check `~/.config/jmux/jmux.log` for details.

---

## Settings Reference

All issue tracking settings are available in the settings screen (`Ctrl-a i`) under **Integrations** and **Issue Workflow**, or in `~/.config/jmux/config.json`:

```json
{
  "adapters": {
    "codeHost": { "type": "gitlab" },
    "issueTracker": { "type": "linear" }
  },
  "issueWorkflow": {
    "teamRepoMap": { "Platform": "~/repos/backend" },
    "defaultBaseBranch": "main",
    "autoCreateWorktree": true,
    "autoLaunchAgent": true,
    "sessionNameTemplate": "{identifier}",
    "statusProgression": ["Ready for Developer", "In Development", "In Review", "Ready for Test"]
  },
  "panelViews": []
}
```

Settings are hot-reloaded — changes take effect without restarting jmux.
