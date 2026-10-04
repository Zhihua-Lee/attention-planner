# Changelog

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
