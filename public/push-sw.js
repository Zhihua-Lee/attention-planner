/* Push reminders. The server sends only an opaque reminder id; the task it refers to is looked up here, on the
   device, from the app's own IndexedDB copy, so task titles never pass through the push service. */
const readDoc = () =>
  new Promise((resolve) => {
    const req = indexedDB.open('attention-planner', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      try {
        const get = req.result.transaction('kv').objectStore('kv').get('doc');
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    };
  });

const safe = (s) =>
  String(s)
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 56);
const live = (xs) => (xs || []).filter((x) => !x.deleted);

function describe(doc, id) {
  if (!doc || !id) return null;
  const kind = id.slice(0, 2);
  const ref = id.slice(2);
  const zh = (doc.settings && doc.settings.lang) !== 'en';
  for (const task of Object.values(doc.tasks || {})) {
    if (task.deleted || task.done) continue;
    if (kind === 'd-' && safe(task.id) === ref)
      return { task, body: zh ? `${task.due === today() ? '今天' : task.due}截止` : `Due ${task.due}` };
    for (const s of live(task.steps))
      if (kind === 'p-' && safe(s.id) === ref)
        return { task, body: zh ? `步骤“${s.text}”今天截止` : `Step “${s.text}” is due today` };
    for (const p of live(task.plan))
      if (kind === 's-' && safe(p.id) === ref)
        return { task, body: zh ? `${p.start} 开始预留的时段` : `Reserved time at ${p.start}` };
  }
  return null;
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    /* plain text or empty: fall back to a generic notice */
  }
  // Every push must show a notification: iOS withdraws push from a web app that receives pushes silently.
  event.waitUntil(
    readDoc().then((doc) => {
      const tag = String(payload.tag || '');
      const zh = !doc || (doc.settings && doc.settings.lang) !== 'en';
      let title = 'Attention Planner';
      let body = '';
      let url = '/';
      const found = describe(doc, tag);
      if (found) {
        title = found.task.title;
        body = found.body;
        url = `/?open=${encodeURIComponent(found.task.id)}`;
      } else if (tag.startsWith('ai_')) {
        // An AI proposed changes; this device may not have synced them yet, so say only that.
        const id = tag.slice(3);
        const p = doc && doc.proposals && doc.proposals[id];
        body = p
          ? zh
            ? `AI 提议：${p.summary}`
            : `AI proposal: ${p.summary}`
          : zh
            ? 'AI 提议了修改，点开查看'
            : 'An AI proposed changes';
        url = `/?proposal=${encodeURIComponent(id)}`;
      } else if (tag.startsWith('test_')) {
        body = zh ? '测试通知：提醒能送到这台设备。' : 'Test: reminders reach this device.';
      } else {
        // The task was finished or changed since the reminder was set.
        body = zh ? '有一个提醒，点开看看现在做什么。' : 'A reminder: open to see what to do now.';
      }
      return self.registration.showNotification(title, {
        body,
        tag: tag || 'attention-planner',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
