# Changelog

## 0.2.12 — 2026-10-06

- **A long-term goal**: Settings → 目标 holds your longest-range direction in your own words (Markdown). Nothing is
  measured. AI connections get it with every "what now" and are asked to keep it in mind when they prioritise, plan
  and break tasks down. NOW can show its first line at the top, quietly (off by default; tap for the whole text).
- README: the hands-free loop from a recorded meeting, through the AI and MCP, to approved steps.
- **Changes are written at once**: they used to wait a quarter of a second, so closing or reloading the page right
  after a change could lose it (it also made two UI tests flaky in CI). The tests now reload only after the write.

## 0.2.11 — 2026-10-06

- **A notification when an AI proposes changes**: every device with reminders on gets one ("AI 提议了修改"); tapping
  it opens the list at the proposal. Only an opaque id passes through the push service. Needs the sync broker's new
  `/api/push/notify` (attention-planner-legacy 537639f1).
- **Fix: notifications could stop on iPhone**: a push whose task had been finished or changed, and the "test"
  push, showed nothing; iOS withdraws push from a web app that receives pushes silently. Every push now shows a
  notification (a generic one when its task is gone).

## 0.2.10 — 2026-10-06

- **Approve AI proposals in the app**: proposals are kept with the tasks and sync like them. The list shows "AI 提议 ·
  N" at the top (open it to see what each would change, before → after), a row marks a task that a proposal would
  change, and the task's details show those changes first. Approving applies them all as one edit, which can be
  undone (the proposal waits again); rejecting changes nothing. The AI's link (`/?proposal=<id>`) opens the list at
  the proposal; the old review pages still serve proposals made before this version.
- **The note no longer jumps when you start editing it**: reading and editing use the same box, font and padding,
  and the editor starts at the height the note had and grows with it.
- The apply-and-describe logic for changes moved from the Worker into the app's model, with a type check that the
  Worker's schemas describe exactly the same changes.

## 0.2.9 — 2026-10-06

- **AI connections can do what the app does**: tasks show what they are linked to and what links to them; a new task
  can be linked and given an explicit repeat; proposals can also edit, remove or promote steps, move a plan, link or
  unlink, set or stop a repeat, rename a project or set it to go one after another, and rename an area. A proposal is
  tried on a copy first, so a wrong id is reported when it is made. The review page words each of these.

## 0.2.8 — 2026-10-06

- **Fix: Claude Code could only read**: it asks for the permissions the server lists as required, which were reading
  only, and the consent page offered only what was asked. Both permissions are now listed and always offered; the
  owner can still untick writing. Reconnect (Re-authenticate) to get writing.

## 0.2.7 — 2026-10-05

- **Find time**: next to a task's estimate, "找时间" lists free working times before its deadline (or in the next
  two weeks), around calendar events and other reserved times, each as long as what is still to reserve (the
  estimate, or an hour, less what is reserved) up to two hours; a shorter gap is offered as a piece. One tap reserves
  it. Reserving never changes the estimate; without one, the hour can be kept as the estimate. The effort row shows
  "还差" once something is reserved.
- **Suggestions for a tapped free time**: the reserve sheet lists the tasks that suit it (soonest deadline, then what
  fits, then important); tap one to choose it. Settings → 日历 turns this off.
- AI connections get a `find_time` tool.

## 0.2.6 — 2026-10-05

- **Dates follow the round in a task that reopens**: its deadline, its steps' deadlines and its plans are kept as
  written for the first round, and each round sees them moved to that round (a weekly list due the day after it
  opens is due the day after each time, instead of "overdue by 7 days"; a reserved time comes back every round).
  Nothing is rewritten when a round opens; a date changed in a later round is stored back relative to the first.
  The screen, reminders and AI connections all read the round's dates.
- **A new copy keeps its steps' deadlines and estimates**, the deadlines moved like the task's.
- **A deadline brings a snoozed task back**: once a deadline (a step's too) is today or past, the task shows in NOW
  and "今天" even while snoozed.
- **Repeating tasks stay out of a project's queue**: in a project done in order they neither wait nor hold the
  other tasks back.
- **Web-page shortcuts are taken over**: Ctrl+S syncs (instead of saving the page), Ctrl+F searches tasks, and
  Ctrl+P/O/U/D/G do nothing.
- docs/interactions.md lists how a task's parts work together.

## 0.2.5 — 2026-10-05

- **Repeats in words**: the capture box reads 每天 / 每3天 / 每个工作日 / 每周一三五 / 每两周 / 每月15号 / 每月最后一天 /
  每年 and daily / weekdays / every mon and thu / every 2 weeks / monthly / yearly. With a deadline each time is a new
  copy (`每周五交周报` is due next Friday and repeats from there); without one the task reopens in place. The repeat
  chip shows even when it sits behind "更多". Tasks added by an AI read the same words.
- **Quick words for steps**: the box under a task's steps reads a date as the step's deadline, a length as its
  estimate, a repeat as its own rule, and 不重复 as "does not reset". What it read shows under the box; tapping a tag
  undoes it and keeps those words in the step's text.

## 0.2.4 — 2026-10-05

- **Fix: a repeating task finished its round with steps still open**: only the steps that follow the task were
  counted, so once those were checked the round was done even if a one-off step (common in lists imported from the
  previous app) or a step on its own rule was still open. Now every open step counts.

## 0.2.3 — 2026-10-04

- **Fix: calendar events shown twice**: Outlook events saved by 0.1.6 and earlier carried no source, so from 0.1.7 on
  they were kept as if imported from a file while fresh Outlook events were added beside them. The next Outlook read
  now replaces them. The same event from two sources (the Outlook export and a subscription to that calendar) is
  also shown once.
- Settings → 日历 counts and clears only the events imported from a file.

## 0.2.2 — 2026-10-04

- **Steps first**: an opened task shows its steps at the top, full width, then its properties, then the note. Steps
  had sat between "用时" and "重复" as if they were a property.

## 0.2.1 — 2026-10-04

- **Fix: allowing an AI was refused** ("请求来自别的网站，已拒绝"): the AI pages sent `Referrer-Policy: no-referrer`,
  which makes browsers post their own forms with `Origin: null`, so the same-origin check rejected them. They now use
  `same-origin`.

## 0.2.0 — 2026-10-04

- **AI connections (MCP)** at `/api/mcp`: AI clients connect with OAuth (the consent page names the client and where
  access goes). Tools: what to do now, list and get tasks, agenda (Outlook and subscribed calendars), areas and
  projects, add a task (saved at once, with the capture box's quick words), and propose changes to existing tasks,
  which wait for approval at a review page. Connections are listed and revoked at `/api/ai/connections`; Settings →
  AI 连接 shows the address. Runs as its own Worker; the sync broker is unchanged. See docs/ai-connections.md.
- **Fix: pages under `/api` were caught by the offline app**: the service worker answered navigations to `/api/*`
  (sign-in, AI pages) with the app shell; they now go to the network.

## 0.1.10 — 2026-10-04

- **Choose the list filters**: Settings → 清单筛选 turns each filter on or off (today, due this week, with a deadline,
  new, snoozed, each area, each project); "all" is always there.
- **"有截止" is back** next to "7 天内截止": it lists every task with a deadline (a step's counts). 0.1.6 had replaced it
  without being asked.

## 0.1.9 — 2026-10-04

- **Day view back to an overview**: one fixed scale of 40 px per hour (about 11 hours on a phone screen) replaces the
  adaptive heights of 0.1.8, which made a day with short items too long to scroll. A half-hour item is one line (title,
  then time); an hour or longer shows the time under the title.
- **Fix: short items covered the next one**: blocks under 45 minutes shared a class name with an unrelated style that
  forced them to at least 32 px tall, so they spilled over the following item. That was the overlap in the day view.

## 0.1.8 — 2026-10-04

- **Day view heights adapt**: an item's height still matches its length, but the hours grow (48–120 px per hour) until
  the shortest item on the day has room for its title and time. Titles wrap by words to the lines the block has,
  instead of being cut to one line.
- **Full width**: a button in the top bar widens the app for reading on a large screen; remembered on this device.
- **Calendar subscriptions now work on the live site**: the `/ics` function deployed with 0.1.7 never matched its
  route, because it was bundled by a Wrangler from another project that resolved a newer `path-to-regexp`. Wrangler
  is now a dev dependency here (`npm run deploy`).

## 0.1.7 — 2026-10-04

- **Calendar subscriptions by address**: add any .ics or webcal link (a class timetable, public holidays) in
  Settings → 日历; it is read now and every 30 minutes, alongside the Outlook export and imported files. Each source
  is replaced on its own. Feeds are fetched through a small function on this site (`/ics`) that passes only
  calendar files, size-capped, and refuses local addresses.

## 0.1.6 — 2026-10-04

- **Steps wrap**: long steps wrap and grow instead of being cut off; Shift+Enter adds a line.
- **Filters follow the tasks**: "今天" now includes overdue and due-today work (step deadlines too), anything planned
  today, open rounds of repeating tasks (a daily one is always there until done), and steps due on their own rule.
  "有截止" became "7 天内截止". "新加的" means not yet given a day, deadline, repeat or place. Chips with nothing in
  them are hidden; areas and projects are chips instead of a drop-down.
- **Sort by hand**: the list can be "智能" (as before) or "手动": drag the handle (or ↑/↓ on it); the order syncs and
  new tasks go on top.

## 0.1.5 — 2026-10-04

- **Reminders**: push notifications on this device on a deadline's day (an hour before one with a time), on a step's
  deadline, and before reserved times, even with the app closed. Times are set in Settings. The push service only sees
  an opaque id and a time; the notification is filled in on the device. Tapping it opens the task.
- **Concurrent edits**: when two devices change the same title or note without seeing each other's change, the later
  one is shown and the other is kept. The task offers "keep this one", "use the other" and "compare"; the list marks
  it "有两个版本". Edits made one after another are not flagged.
- **Projects done in order**: a project can be marked "按顺序". Its tasks go in the order they were added; later ones
  are shown as queued and are not suggested in NOW until the earlier ones are done.
- Closing or reloading the page no longer writes unchanged data, so another tab's save is never overwritten.

## 0.1.4 — 2026-10-04

Steps can carry more, without getting noisier.

- A step can have its own deadline. The earliest unfinished one leads: NOW says "步骤“画图”今天截止", the list shows
  it, and the agenda marks it on its day.
- A step can have an estimate; without a task estimate, the task's effort is the sum of its steps, and what is left
  counts only unfinished steps.
- Step repeat is back in full: any step, in any task, can follow the task's rounds (when it reopens), not repeat, or
  repeat on its own rule with the same form as tasks.
- A step can become its own task, linked to the old one and keeping its deadline and estimate.
- Steps reorder by dragging the handle (or ↑/↓ on it), instead of two buttons.
- Settings choose which buttons follow each step (deadline, effort, repeat, make it a task); dragging and deleting
  are always there. On a phone the buttons appear when a step is tapped, and steps use the full width.
- A task without an estimate shows "未填" instead of a second "设置".

## 0.1.3 — 2026-10-04

The 0.1.2 Outlook-style redesign was rolled back; these changes build on the 0.1.1 agenda instead.

- The day view scrolls through all 24 hours, opens at the current time, and marks now with a line and the time.
- Events and reserved times that overlap sit side by side.
- Tap any event, reserved time or task in the agenda for details: time, length, location, effort and steps, with
  "open task", "change time" and "remove" where they apply.
- Tap an empty time to reserve it: for a new task or one from the list, with an adjustable start and length, and a
  note when it overlaps something. On a phone the form rises from the bottom and stays above the keyboard.
- All-day events (Outlook export, .ics) show above the day and in the week list; they never count as busy time.

## 0.1.2 — 2026-10-04 (rolled back)

An Outlook-style calendar replaced the agenda; it went further than asked and was reverted.

## 0.1.1 — 2026-10-04

Now served at todo.onthat.top in place of the previous app.

- The previous app's data in this browser is imported automatically on first start, once, with undo.
- Sync connects by itself when the sync broker next to the app reports a connected Google Drive.
- The Outlook calendar export that Power Automate keeps in Google Drive (`outlook-calendar.json`) is read after each
  sync and shown in NOW; Settings shows when it was last updated.
- Security headers (CSP, framing, referrer, caching).

## 0.1.0 — 2026-10-04

First working build of the rewrite.

- NOW: one suggestion with its reason and key facts, a capacity warning, and a day/week agenda with navigation.
- One list with filters (today, new, due, snoozed, area/project) and linked tasks grouped under their target.
- One-line capture with Chinese and English parsing and guided chips (deadline → when → effort → importance).
- Arrangements on several days: no set time, part of day, or a reserved time from a half-hour grid with durations;
  minutes worked can be logged on a reserved time.
- Repeat: reopen in place (rounds, history, per-step rules) or a new copy (series by date or count).
- Snooze replaces waiting / someday / "not before".
- Search, undo for every change, keyboard shortcuts, settings (theme, language, working time, chip order, groups).
- Import from the previous app's JSON and from `.ics`; export a backup.
- Offline PWA with installable icons; IndexedDB storage.
- Sync engine with field-level merge and conditional writes; Google Drive remote through the sync broker (see
  `docs/sync-setup.md`; not yet connected).
