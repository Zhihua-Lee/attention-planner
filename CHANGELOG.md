# Changelog

## 0.1.2 — 2026-10-04

A calendar like Outlook's in NOW.

- Day, 3-day and week views: dates on top with today circled, an all-day strip (all-day events, deadlines, tasks without
  a set time), and an hour grid that opens at the current time with a red now line.
- Overlapping events sit side by side; each shows its title, time and location.
- Click an empty spot to reserve that time for a new task.
- On a wide screen NOW shows the task card on the left and the calendar on the right; the week view opens by default.
- All-day events are read from the Outlook export and from .ics files; they never count as busy time.

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
