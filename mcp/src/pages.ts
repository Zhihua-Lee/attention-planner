/** The few pages the owner sees in a browser: allowing an AI, reviewing its proposals, managing connections. */

export const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const SCOPE_WORDS: Record<string, string> = {
  'tasks:read': '查看任务、日程和“现在做什么”',
  'tasks:write': '直接新建任务；修改已有任务时先发来让你批准',
};

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f5f2;--card:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e2e0da;--accent:#2f6f5e;--warn:#a2462e}
@media (prefers-color-scheme:dark){:root{--bg:#1b1d1c;--card:#232624;--ink:#ecebe6;--muted:#a3a39b;--line:#363a37;--accent:#7fc4ae;--warn:#e08a6e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:560px;margin:0 auto;padding:32px 16px 48px}h1{font-size:20px;margin:0 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
.muted{color:var(--muted);font-size:14px}.warn{color:var(--warn)}ul{padding-left:20px;margin:8px 0}li{margin:6px 0}
label{display:flex;gap:8px;align-items:flex-start;margin:8px 0}input[type=checkbox]{margin-top:5px}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}button{font:inherit;border-radius:8px;padding:8px 16px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--card)}a{color:var(--accent)}code{font-size:13px;word-break:break-all}
`;

export function page(title: string, body: string, status = 200, headers?: Headers): Response {
  const h = headers ?? new Headers();
  h.set('Content-Type', 'text/html; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  h.set(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  );
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'no-referrer');
  return new Response(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${STYLE}</style></head><body><main><h1>${escape(title)}</h1>${body}</main></body></html>`,
    { status, headers: h },
  );
}

export const message = (title: string, text: string, status = 200) =>
  page(title, `<div class="card"><p>${text}</p><p><a href="/">回到 Attention Planner</a></p></div>`, status);

export function consentBody(
  details: { clientName: string; clientDomain?: string; redirectHost: string; redirectIsLoopback: boolean },
  scopes: string[],
  handle: string,
): string {
  const who = details.clientDomain
    ? `来自 <strong>${escape(details.clientDomain)}</strong>`
    : '<span class="warn">它自己注册的名字，未经验证</span>';
  const boxes = scopes
    .map(
      (s) =>
        `<label><input type="checkbox" name="scope" value="${escape(s)}" checked ${s === 'tasks:read' ? 'disabled' : ''}>${escape(SCOPE_WORDS[s] ?? s)}</label>${s === 'tasks:read' ? `<input type="hidden" name="scope" value="tasks:read">` : ''}`,
    )
    .join('');
  return `<div class="card">
<p><strong>${escape(details.clientName)}</strong>（${who}）想连接你的清单。授权会交给 <strong>${escape(details.redirectHost)}</strong>。</p>
${details.redirectIsLoopback ? '<p class="warn">这会把权限交给你电脑上的一个程序。只有刚从它那里发起连接时才继续。</p>' : ''}
<form method="post">
<input type="hidden" name="handle" value="${escape(handle)}">
${boxes}
<p class="muted">任何时候都可以在“AI 连接”页面断开。它不会删除任何东西，删除也要你批准。</p>
<div class="row"><button class="primary" name="decision" value="approve">允许</button><button name="decision" value="deny">拒绝</button></div>
</form></div>`;
}

export function reviewBody(
  p: { id: string; summary: string; client: string; nonce: string },
  when: string,
  lines: string[],
  state: 'pending' | 'applied' | 'rejected' | 'failed' | 'lapsed',
  error?: string,
): string {
  const items = lines.map((l) => `<li>${escape(l)}</li>`).join('');
  const head = `<p class="muted">${escape(p.client)} · ${escape(when)}</p><p><strong>${escape(p.summary)}</strong></p><ul>${items}</ul>`;
  const status = {
    pending: '',
    applied: '<p>已批准并保存。打开应用就能看到。</p>',
    rejected: '<p>已拒绝，没有任何改动。</p>',
    failed: `<p class="warn">没有保存：${escape(error ?? '')}</p>`,
    lapsed: '<p class="muted">已过期（超过三天未处理），没有任何改动。</p>',
  }[state];
  const form =
    state === 'pending'
      ? `<form method="post"><input type="hidden" name="nonce" value="${escape(p.nonce)}"><div class="row"><button class="primary" name="decision" value="approve">全部批准</button><button name="decision" value="reject">拒绝</button></div></form>`
      : '';
  return `<div class="card">${head}${status}${form}</div><p><a href="/">回到 Attention Planner</a></p>`;
}

export function connectionsBody(
  grants: { id: string; client: string; scope: string[]; createdAt: number }[],
  mcpUrl: string,
): string {
  const list = grants
    .map(
      (g) => `<div class="card"><strong>${escape(g.client)}</strong>
<p class="muted">${escape(new Date(g.createdAt * 1000).toISOString().slice(0, 10))} · ${g.scope.map((s) => escape(SCOPE_WORDS[s] ?? s)).join('；')}</p>
<form method="post"><input type="hidden" name="grant" value="${escape(g.id)}"><button name="action" value="revoke">断开</button></form></div>`,
    )
    .join('');
  return `<p class="muted">在 AI 客户端里添加这个 MCP 地址：<br><code>${escape(mcpUrl)}</code></p>${list || '<div class="card"><p>还没有连接的 AI。</p></div>'}<p><a href="/">回到 Attention Planner</a></p>`;
}
