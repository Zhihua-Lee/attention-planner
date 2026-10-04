# Attention Planner

**One list. The app tells you what to do now.**

Attention Planner is a to-do app for people who would rather not run a system. You write things down; the app keeps them,
orders them and, whenever you look, shows the one thing worth doing next and why. There is no inbox to process, no
weekly ritual and no status to keep up to date.

[中文说明](README.zh-CN.md) · [User guide (中文)](docs/user-guide.md) · [Design](docs/design.md) · [Development](docs/development.md) · [Sync setup](docs/sync-setup.md) · [Verification](VERIFICATION.md)

## What it does

- **NOW**: a single suggestion with its reason ("reserved time now · until 17:00", "due today", "marked important"),
  the facts that matter (deadline, effort, steps), and today's agenda underneath. Switch to the week or move day by day.
- **One list**: every open task in one place. Filters (today, new, due, snoozed, by area or project) narrow it; nothing
  ever moves somewhere else because you changed a field.
- **Capture in one line**: type `report due fri 3h !` or `周五交报告 3小时 !` and press Enter. Chips under the box show
  what was recognised and offer the next useful detail in order: deadline, when, effort, importance.
- **When, not just a date**: arrange a task on several days, each with no set time, a part of the day, or a reserved
  time picked from a half-hour grid that greys out what is already taken.
- **Repeat, two ways**: _reopen_ the same task each round (its steps clear and its history is kept) or create a _new
  copy_ when you finish. Rules follow the calendar or count from completion; a series can end on a date or after a
  number of times. Steps can follow the task, repeat on their own, or not repeat.
- **Is there time?** With an effort estimate, the app compares what is due by each deadline with the free working time
  before it and tells you if it will not fit.
- **Snooze** replaces "waiting", "someday" and "not before": the task stays in the list, greyed, until the day you chose.
- **Search** titles, notes and steps from one box (`/` or `Ctrl+K`). **Undo** every change (`Ctrl+Z`).
- **Works offline** as an installable PWA (iPhone home screen included). Data lives on the device in IndexedDB.
- **Sync** through Google Drive, merging field by field so two devices never overwrite each other.
- **Import** a JSON export from the previous app and an `.ics` calendar file.

Chinese and English interface; light and dark themes; respects reduced motion.

## Status

Version 0.1.0 is the first working build. Google Drive sync is implemented and tested against a simulated drive; it
still has to be connected to the sync broker for real use. Outlook calendar and push reminders are not built yet. See
[VERIFICATION.md](VERIFICATION.md) for what has been checked.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` writes the PWA to `dist/`. See [docs/development.md](docs/development.md).

## License

All rights reserved for now. This repository contains no code from any other application; bundled libraries and their
licenses are listed in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
