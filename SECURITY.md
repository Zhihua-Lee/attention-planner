# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub security advisories for this repository](https://github.com/Zhihua-Lee/attention-planner/security/advisories/new). Do not open a public issue for anything exploitable.

请通过本仓库的 [GitHub 私密安全报告](https://github.com/Zhihua-Lee/attention-planner/security/advisories/new) 提交漏洞，不要在公开 issue 中描述可被利用的问题。

Include what is affected (PWA, sync broker, remote MCP), steps to reproduce, and the impact you expect. This is a personal project maintained by one person; reports are handled on a best-effort basis.

## Supported version

Only the latest deployment of `main` at [todo.onthat.top](https://todo.onthat.top) is supported. There are no versioned releases.

## Scope

| Component | Where it runs | Notes |
| --- | --- | --- |
| PWA (`apps/desktop`) | The user's browser, served from Cloudflare Pages | Task data stays in browser storage and the user's Google Drive `appDataFolder`. |
| Sync broker (`apps/sync-broker`) | Cloudflare Worker at `todo.onthat.top/api` | Handles Google OAuth token exchange and Web Push, and never sees task content on these paths. |
| Remote MCP (`apps/sync-broker`) | Same Worker, disabled by default (`MCP_ENABLED=false`) | When enabled, it processes the app snapshot per request and stores encrypted, expiring change previews. Every change needs the owner's approval. |

Code inherited from Mindwtr and not deployed by this project is out of scope here: the native apps, `apps/cloud`, `apps/mcp-server` and the release workflows. Issues in that code that also affect upstream should be reported to [Mindwtr](https://github.com/dongdongbh/Mindwtr/security/policy).

The data paths are described in detail in the [privacy notes](./docs/PRIVACY.md) and the [remote MCP guide](./docs/attention-planner-mcp.md).
