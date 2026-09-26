import type { McpOperation, TaskChange } from './mcp-service';

export const escapeHtml = (text: unknown): string => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function mcpPage(title: string, body: string, status = 200): Response {
    const nonce = crypto.randomUUID();
    return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)} · Attention Planner</title><style nonce="${nonce}">
    :root{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:light dark;font-size:16px}body{margin:0;background:Canvas;color:CanvasText;line-height:1.65}main{max-width:800px;margin:auto;padding:32px 20px 72px}h1{font-size:1.8rem;line-height:1.25}h2{font-size:1.2rem;margin-top:28px}.meta{font-size:.9rem;opacity:.8;overflow-wrap:anywhere}.notice,section{border:1px solid color-mix(in srgb,CanvasText 22%,transparent);border-radius:12px;padding:16px;margin:16px 0}.notice{border-inline-start:4px solid currentColor}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.diff{display:grid;grid-template-columns:1fr 1fr;gap:16px}dt{font-weight:600}dd{margin:4px 0 16px;padding:10px;border:1px solid color-mix(in srgb,CanvasText 15%,transparent);border-radius:6px;min-width:0}button,a{touch-action:manipulation}button{font:inherit;min-height:48px;border-radius:8px;border:1px solid currentColor;padding:10px 18px;background:Canvas;color:CanvasText;cursor:pointer}.primary{background:CanvasText;color:Canvas}.actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}a{color:LinkText}:focus-visible{outline:3px solid Highlight;outline-offset:4px}@media(max-width:560px){.diff{grid-template-columns:1fr;gap:0}main{padding:24px 16px 56px}.actions button{flex:1}h1{font-size:1.55rem}}
    </style></head><body><main><a href="/">Attention Planner</a><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`, { status, headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    } });
}
const labels: Record<string, string> = { title: '标题', description: '正文', checklist: '勾选步骤', status: '状态',
    completedAt: '完成时间', deletedAt: '移入回收站', parentTaskId: '父任务', projectId: '项目', areaId: '领域',
    availableAt: '可开始日期', dueDate: '截止日期', planner: '时间安排', recurrence: '重复规则' };
function displayValue(value: unknown, field: string): string {
    if (value === null || value === undefined) return '（无）';
    if (typeof value === 'string') return value;
    if (field === 'planner' && typeof value === 'object') {
        const planner = value as { blocks?: { startAt: string; timeZone: string; durationMinutes: number; state: string }[]; days?: { date: string; selected: boolean }[] };
        const states: Record<string, string> = { scheduled: '已安排', pending: '待重新安排', done: '已完成时间块', cancelled: '已取消' };
        const blocks = (planner.blocks ?? []).map(b => {
            let time = b.startAt;
            try { time = new Intl.DateTimeFormat('zh-CN', { timeZone: b.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(b.startAt)); } catch { /* Keep the explicit ISO value if legacy data has no usable zone. */ }
            return `${time} · ${b.timeZone} · ${b.durationMinutes} 分钟 · ${states[b.state] ?? b.state}`;
        });
        const days = (planner.days ?? []).filter(d => d.selected).map(d => `今日承诺：${d.date}`);
        return [...blocks, ...days].join('\n') || '（无时间块）';
    }
    if (field === 'checklist' && Array.isArray(value)) return value.map(item => `${item.isCompleted ? '☑' : '☐'} ${item.title}`).join('\n') || '（无步骤）';
    return JSON.stringify(value, null, 2);
}
function renderChange(change: TaskChange): string {
    return `<section><h2>${escapeHtml(change.title)}</h2>${change.fields.map(field => `<h3>${escapeHtml(labels[field.name] ?? field.name)}</h3><dl class="diff"><div><dt>修改前</dt><dd><pre>${escapeHtml(displayValue(field.before, field.name))}</pre></dd></div><div><dt>修改后</dt><dd><pre>${escapeHtml(displayValue(field.after, field.name))}</pre></dd></div></dl>`).join('')}</section>`;
}
export function renderMcpReview(op: McpOperation, csrf: string): Response {
    const pending = op.status === 'pending' && Date.now() < op.expiresAt;
    const statuses: Record<string, string> = { pending: '等待你确认', writing: '正在保存', applied: '已保存', rejected: '已拒绝', conflict: '数据已变化，请重新预览', uncertain: '保存结果待核实' };
    return mcpPage(pending ? '确认 AI 的修改' : '操作记录', `<p>以下内容来自 AI 建议。只有你点击确认后，才会保存到 Google Drive。</p>
        <p class="meta">客户端：${escapeHtml(op.actor.clientId)}<br>预览生成：${escapeHtml(op.createdAt)}<br>状态：${escapeHtml(statuses[op.status] ?? op.status)}</p>
        <p>${escapeHtml(op.prepared.summary)}</p>
        ${(op.prepared.warnings ?? []).map(warning => `<p class="notice">${escapeHtml(warning)}</p>`).join('')}
        ${op.changes.map(renderChange).join('')}
        <p class="notice">只包含最后同步到 Google Drive 的数据。其他设备尚未同步的修改不可见。若预览已过期或同步数据发生变化，请让 AI 重新生成。</p>
        ${pending ? `<form method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><p>点击确认，表示你已核对以上修改与提示。</p><div class="actions"><button name="decision" value="reject">拒绝修改</button><button class="primary" name="decision" value="approve">确认并保存</button></div></form>` : '<p>该预览当前不能批准。返回聊天查看结果，或请求新的预览。</p>'}
        <p><a href="/api/mcp/connections">管理或撤销 AI 连接</a></p>`);
}
