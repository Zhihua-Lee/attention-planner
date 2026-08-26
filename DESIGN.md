# Attention Planner UI direction

## Product thesis

Attention Planner is a quiet scheduling workspace, not a GTD dashboard. It should feel like a clear sheet for deciding what matters now: ordered by time and commitment, with color reserved for the next meaningful action.

## Information architecture

- Primary navigation is only **NOW**, **Inbox**, and **Plan**.
- **NOW** answers one question: what should I attend to now?
- **Inbox** captures first and defaults to four decisions: Ready, Later, Someday, Trash.
- **Plan** contains Today, Calendar, Projects, Later, and Recurring.
- Review, Contexts, Board, Reference, and other inherited Mindwtr tools remain advanced utilities.

## Visual rules

- Prefer one dominant reading column, quiet dividers, and whitespace over nested cards.
- Use sentence case, restrained type sizes, and tabular numerals for time and counts.
- Use the primary accent for a current selection or decisive action, not decoration.
- Lists should scan in one line when possible; metadata is secondary and may wrap below, never through the title.
- Touch targets remain at least 44 px on mobile. Keyboard focus must always remain visible.

## Semantic rules

- Content, status, time, and attention are separate layers.
- `availableAt` controls when a task may surface; `scheduledAt` creates a time block; `snoozedUntil` temporarily hides a NOW suggestion; `dueDate` is a deadline.
- Area → Project → Task is the content hierarchy, but a Task may belong directly to an Area.
- Flexible Frames are background selection rules configured in Settings; they are not containers or a daily planning panel.

## Avoid

- Dashboard grids of equal-weight panels.
- Requiring project, area, context, tag, priority, energy, or estimate during ordinary Inbox processing.
- Mixing Pomodoro, review queues, saved filters, Frame editing, and Today planning on one screen.
- Writing default scheduling or deferral actions to legacy `startTime`; advanced import/editor compatibility remains until a later migration.
