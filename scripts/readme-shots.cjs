// README screenshots: a demo document at a fixed time, in English and Chinese, against `vite preview` on :4173.
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const repo = path.join(__dirname, '..') + '/';
const { chromium } = createRequire(repo + 'package.json')('@playwright/test');
const out = (lang, name) => path.join(__dirname, '..', 'docs', 'images', lang, name);

const S = (rev, by = 'phone') => ({ rev, at: `2026-10-06T1${rev % 10}:00:00.000Z`, by });
const T = { zh: (zh) => zh, en: (_zh, en) => en };

function demo(lang) {
  const t = (zh, en) => (lang === 'zh' ? zh : en);
  const task = (id, fields, extra = {}) => ({
    id,
    created: '2026-10-01T15:00:00.000Z',
    plan: [],
    steps: [],
    rounds: [],
    fs: Object.fromEntries(Object.keys(fields).map((k) => [k, S(1)])),
    s: S(1),
    ...fields,
    ...extra,
  });
  const step = (id, text, order, more = {}) => ({ id, text, order, s: S(1), ...more });
  return {
    v: 1,
    clock: 20,
    tasks: {
      serra: task(
        'serra',
        {
          title: t('投 Lumen 论文', 'Submit the Lumen paper'),
          due: '2026-10-09',
          star: true,
          projectId: 'paper',
          note: t(
            '投稿说明：[Lumen author guide](https://example.com/lumen)。上次的经验：图先定稿，再改引言。',
            'Submission notes: [Lumen author guide](https://example.com/lumen). Last time: fix the figures first, then the introduction.',
          ),
        },
        {
          steps: [
            step('s1', t('写摘要', 'Write the abstract'), 0, { done: true, effort: 45 }),
            step('s2', t('画结果图', 'Draw the result figures'), 1, { due: '2026-10-07', effort: 60 }),
            step('s3', t('改引言', 'Revise the introduction'), 2, { effort: 90 }),
            step('s4', t('检查参考文献', 'Check the references'), 3, { effort: 30 }),
          ],
          plan: [{ id: 'pl1', day: '2026-10-06', start: '14:30', minutes: 60, s: S(1) }],
        },
      ),
      ta: task(
        'ta',
        {
          title: t('TA 每周清单', 'TA weekly checklist'),
          areaId: 'teach',
          repeat: {
            mode: 'reopen',
            rule: { freq: 'weekly', every: 1, fromDone: false, weekdays: [2], start: '2026-09-29' },
          },
        },
        {
          steps: [
            step('t1', t('改作业', 'Grade homework'), 0, { doneIn: '2026-10-06' }),
            step('t2', t('回学生邮件', 'Answer student mail'), 1),
            step('t3', t('更新成绩表', 'Update the gradebook'), 2),
          ],
        },
      ),
      mail: task('mail', {
        title: t('看邮件', 'Check mail'),
        effort: 20,
        repeat: { mode: 'reopen', rule: { freq: 'daily', every: 1, fromDone: false, start: '2026-09-01' } },
      }),
      expense: task('expense', { title: t('交报销', 'Submit expenses'), due: '2026-10-06', effort: 20 }),
      research: task(
        'research',
        { title: t('稀疏传感的新想法', 'Ideas on sparse sensing'), areaId: 'research' },
        {
          plan: [{ id: 'pl2', day: '2026-10-07', part: 'am', s: S(1) }],
        },
      ),
      read: task('read', {
        title: t('读 3 篇文献', 'Read three papers'),
        areaId: 'research',
        snooze: { until: '2026-10-10', reason: t('等导师发清单', 'waiting for the reading list') },
      }),
      gym: task('gym', {
        title: t('跑步', 'Run'),
        repeat: {
          mode: 'reopen',
          rule: { freq: 'weekly', every: 1, fromDone: false, weekdays: [1, 3, 5], start: '2026-09-28' },
        },
      }),
    },
    areas: {
      research: { id: 'research', name: t('研究', 'Research'), order: 0, s: S(1) },
      teach: { id: 'teach', name: t('教学', 'Teaching'), order: 1, s: S(1) },
    },
    projects: { paper: { id: 'paper', name: t('论文', 'Paper'), areaId: 'research', order: 0, s: S(1) } },
    proposals: {
      prop1: {
        id: 'prop1',
        summary: t('把 Lumen 拆细一点，并留出审稿回复', 'Split Lumen further and leave room for the reply'),
        client: 'Claude Code',
        created: '2026-10-06T15:05:00.000Z',
        status: 'pending',
        changes: [
          { type: 'edit_step', task_id: 'serra', step_id: 's3', due: '2026-10-08', effort_minutes: 60 },
          {
            type: 'add_step',
            task_id: 'serra',
            text: t('写给审稿人的回复模板', 'Draft the reply template for reviewers'),
          },
          { type: 'link', task_id: 'research', to: 'serra' },
          {
            type: 'add_task',
            title: t('回复审稿意见', 'Reply to the reviewers'),
            due: '2026-10-20',
            effort_minutes: 120,
            link_to: 'serra',
            steps: [t('逐条列出意见', 'List every comment'), t('补跑实验', 'Rerun the experiments')],
          },
        ],
        s: S(19, 'ai'),
      },
    },
    events: [
      {
        id: 'e1',
        title: t('助教例会', 'TA meeting'),
        day: '2026-10-06',
        start: '09:30',
        end: '10:30',
        source: 'outlook',
      },
      {
        id: 'e2',
        title: t('答疑时间', 'Office hours'),
        day: '2026-10-06',
        start: '12:30',
        end: '13:30',
        source: 'outlook',
      },
      {
        id: 'e3',
        title: t('数值分析', 'Numerical Analysis'),
        day: '2026-10-06',
        start: '13:30',
        end: '14:20',
        location: 'Room 210',
        source: 'outlook',
      },
      {
        id: 'e4',
        title: t('组会', 'Group meeting'),
        day: '2026-10-06',
        start: '16:00',
        end: '17:00',
        source: 'outlook',
      },
    ],
    settings: {
      workStart: '09:00',
      workEnd: '18:00',
      workDays: [1, 2, 3, 4, 5],
      chips: ['due', 'plan', 'effort', 'star'],
      theme: 'light',
      lang,
      s: S(1),
    },
  };
}

async function open(browser, lang, viewport, wide) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    timezoneId: 'America/Chicago',
    locale: lang === 'zh' ? 'zh-CN' : 'en-US',
    colorScheme: 'light',
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-10-06T11:05:00-05:00') });
  await page.goto('http://localhost:4173/');
  await page.evaluate(
    ([doc, wide]) =>
      new Promise((resolve) => {
        if (wide) localStorage.setItem('ap:wide', '1');
        localStorage.setItem('ap:legacy-imported', '1');
        const req = indexedDB.open('attention-planner', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => {
          const tx = req.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(doc, 'doc');
          tx.oncomplete = () => resolve();
        };
      }),
    [demo(lang), wide],
  );
  await page.reload();
  await page.waitForSelector('.tabs');
  await page.waitForTimeout(600);
  return { page, context };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM });
  for (const lang of ['en', 'zh']) {
    fs.mkdirSync(path.dirname(out(lang, 'x')), { recursive: true });
    const tr = (zh, en) => (lang === 'zh' ? zh : en);

    // NOW on a wide screen, with the day view.
    {
      const { page, context } = await open(browser, lang, { width: 1280, height: 860 }, true);
      await page.getByRole('button', { name: tr('日', 'Day'), exact: true }).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: out(lang, 'now.png') });
      await context.close();
    }
    // The list with the AI proposal open.
    {
      const { page, context } = await open(browser, lang, { width: 760, height: 900 }, false);
      await page.getByRole('tab', { name: tr('清单', 'List') }).click();
      await page.getByRole('button', { name: new RegExp(tr('AI 提议 ·', 'AI proposals ·')) }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: out(lang, 'proposal.png'), clip: { x: 0, y: 0, width: 760, height: 760 } });
      await context.close();
    }
    // A task opened: steps first, then the properties, with Find time.
    {
      const { page, context } = await open(browser, lang, { width: 760, height: 1100 }, false);
      await page.getByRole('tab', { name: tr('清单', 'List') }).click();
      await page
        .locator('.row', { has: page.locator('.tt', { hasText: tr('投 Lumen 论文', 'Submit the Lumen paper') }) })
        .locator('.title-btn')
        .click();
      await page.waitForTimeout(500);
      await page.getByRole('button', { name: tr('找时间', 'Find time') }).click();
      await page.waitForTimeout(300);
      const row = page.locator('.row', { has: page.getByTestId('task-detail') });
      const box = await row.boundingBox();
      const menu = await page.locator('.find-time').boundingBox();
      const bottom = Math.max(box.y + box.height, menu ? menu.y + menu.height : 0) + 12;
      await page.screenshot({
        path: out(lang, 'detail.png'),
        clip: { x: 0, y: Math.max(0, box.y - 12), width: 760, height: bottom - Math.max(0, box.y - 12) },
      });
      await context.close();
    }
  }
  await browser.close();
  console.log('done');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
