# Attention Planner 隐私说明

更新日期：2026-09-26。本文适用于本仓库的 Attention Planner 个人 PWA 分支，不以上游 Mindwtr 的隐私政策替代本分支的 Google 授权、推送和远程 MCP 说明。

公开页面的源码为 [privacy.html](../apps/desktop/public/privacy.html)；部署后对应 [todo.onthat.top/privacy.html](https://todo.onthat.top/privacy.html)。本次远程 MCP 源码默认关闭，尚未部署；文档描述启用后的处理方式，不表示线上已经开放。

## 默认路径与可选路径

| 路径 | 处理哪些信息 | Cloudflare 的边界 |
| --- | --- | --- |
| PWA 本地工作副本 | 任务、项目、设置和缓存 | 浏览器本地保存；Pages 提供程序代码 |
| 普通 Google Drive 同步 | 隐藏的 `appDataFolder/attention-planner-v2.json` | 浏览器直接交换 JSON，OAuth 路径不接收正文 |
| Outlook 私有导出 | 事件 ID、标题、开始、结束、地点、全天标志 | Power Automate 写入私人 Drive，PWA 直接读取；MCP 不读取该文件 |
| Google 长期授权 | 获准邮箱、会话、加密刷新令牌 | 单账号 Worker / Durable Object；短时令牌供 PWA 使用 |
| Web Push | 订阅端点、不含正文的提醒 ID 与时间 | 通用提醒，不发送任务标题／正文 |
| 可选远程 MCP | 最新应用同步快照、任务工具结果、修改提议 | Worker 请求期间处理整个快照；加密暂存操作记录，不持久保存整库快照 |

`drive.appdata` 限于本应用的隐藏数据；`drive.file` 限于应用创建或你明确打开的普通文件，不是遍历整个 Drive 的权限。Power Automate 的 Google 连接由 Microsoft 管理，权限可能更宽，应单独检查。

## 启用 MCP 代表什么

远程服务要在 PWA 关闭时工作，必须能够自行取得已同步数据。因此启用该功能后，不能再笼统声称“Cloudflare 从不接触正文”。Worker 为安全检查和合并会临时处理完整应用快照，包含任务、项目和同步设置；AI 工具仅返回选定任务字段，不返回设置、附件或外部日历导出。

读取权限是任务库级别，不是逐任务授权；按需返回少量数据不能替代访问控制。第一版必须授予读取权限，创建和提出修改可选，没有只创建而不读取的连接模式。不接受某个客户端具备查询任务库权限时，不要连接它。

AI 客户端得到独立 MCP OAuth 令牌，不是 Google 刷新令牌、Google 密码或 PWA Cookie。每个客户端分别授权和撤销。新建草稿直接进入 Inbox；对已有内容、清单、父子关系、完成／重新打开、软删除、日期和时间块的修改，须由账号所有者在浏览器查看预览后确认。

你调用哪个 AI，该提供商就会收到本次工具返回的数据；不因 PWA 关闭而改变这一事实，也不因接了多个客户端而每次发送给所有提供商。AI 对话保留、训练使用及数据控制取决于产品、账号和设置。本项目不出售数据、不投放行为广告、不自行训练模型，但不能替第三方承诺不留存或不训练。

## 保存多久

- Google 刷新令牌应用层加密保存，断开 Google Drive 时撤销并删除。现有浏览器会话有效期为 180 天。
- MCP OAuth 客户端、授权和令牌状态由 Cloudflare KV 保存。访问令牌配置为 15 分钟，刷新令牌为 30 天，并非保证永久可用。
- MCP 操作记录保存在独立 Durable Object 中，使用 AES-GCM 加密。记录含相关任务的必要内容、前后预览、客户端身份、状态和结果摘要，不是只有不含正文的元数据。
- 预览 24 小时后不能批准；记录创建七天后不可再读取，按小时执行清理。撤销客户端或断开 Drive 不会立即抹去这些尚未到期的加密记录。
- Cloudflare、Google、Microsoft、推送服务及 AI 提供商的基础设施日志、备份和对话副本遵循各自政策；本项目无法通过删除本地数据来删除这些副本。

## 如何控制与停用

在 [AI 连接管理](https://todo.onthat.top/api/mcp/connections)撤销特定客户端，不会断开其他客户端或普通 PWA 的 Google 同步。每次工具访问和批准时会检查授权，但 KV 传播存在延迟，不承诺瞬时全球生效。需要服务级停止时，维护者应关闭 `MCP_ENABLED` 并部署。

撤销不会回滚已批准的修改，也不会撤回 AI 已经收到的内容。若要彻底停用整个系统，先导出备份，再分别处理 AI 连接、各设备推送、PWA Google 授权、Power Automate 流和连接，最后按需删除 Drive 文件及浏览器本地数据。

## 安全限制

采用 HTTPS、PKCE、单账号白名单、最小 Google 权限、令牌与操作记录加密、浏览器确认及条件写入。应用层加密保护存储记录，不代表运行中的服务不能解密或读取。静态代码更新、Cloudflare 和 GitHub 部署账号仍属于信任边界。

服务器不主动记录任务正文、快照或令牌；仓库配置关闭 Worker observability，但不能据此承诺所有第三方基础设施都没有请求日志。公开 Issue 不应粘贴私人任务、导出文件或凭据。

MCP 不读取 Outlook 事件，不能保证建议时段没有课程或会议；周期规则目前复用 UTC 运行的核心逻辑，确认时应检查实际生成的日期。没有绝对安全保证，也没有任意 iOS 后台执行保证。

详见 [远程 MCP 手册](./attention-planner-mcp.md)。上游的其他平台／可选 AI 功能可另参考 [Mindwtr 隐私政策](https://mindwtr.app/privacy)，但该政策不替代本分支说明。
