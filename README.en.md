# Xingzhou · Personal Projects & Tasks

Xingzhou is a SiYuan plugin for managing personal projects with low friction. A native Attribute View remains the single source of truth; the plugin adds a focused interface for browsing and progressively expanding the work that currently needs attention.

> Current version: `0.1.0` (early test release; `main` includes later unreleased iterations)

[中文说明](README.md) · [中文更新日志](CHANGELOG.md) · [English Changelog](CHANGELOG.en.md)

## Goals

- Reduce the decision cost of choosing what to do in limited personal time.
- Capture long-term areas, projects, tasks, transactions, and ideas in one database.
- Keep complete project maps in project documents and only managed work items in the database.
- Store only the direct parent relation and reconstruct the full hierarchy from it.
- Keep simple one-off transactions in the database without forcing a document.
- Follow SiYuan themes and dark mode.
- Avoid turning personal project management into performance pressure.

## Current development status

- Reads the “全部工作项” view from a configured SiYuan Attribute View.
- Long-term area and independent work-item navigation.
- Active-path expansion and collapse-all controls.
- All, active project, someday, and closed filters.
- Direct detail editing for hierarchy, type, status, dates, duration, and energy.
- Title-level completion control that disappears after completion while status remains the single lifecycle source of truth.
- Click-to-edit current-action and next-action cards with blur-to-save, Escape to cancel, and Cmd/Ctrl+Enter to save.
- Setting a plan date can move Inbox/Ready items to Planned, but dates never pretend that work has actually started.
- Derived Today and Overdue badges that do not overwrite lifecycle status.
- A real Week page with Monday-to-Sunday dates, previous/current/next week navigation, moving, unscheduling, and completion controls.
- An Unscheduled pool limited to executable Transactions and Ideas, plus reminders for items currently inside their plan-to-deadline window.
- A five-step Review page covering Inbox, active top-level projects, stale dates, missing action details, and this week's closed items.
- Review prioritization ensures each item appears in only one highest-priority step per review pass.
- Opens linked SiYuan documents and the native database block.
- Warns about self-parenting, multiple parents, missing parents, cycles, and top-project mismatches.
- Loading, empty, error, and missing-optional-field states.
- SiYuan theme token and dark-mode support.
- Configurable Attribute View ID and database block ID.

This release writes only after explicit capture, editing, scheduling, unscheduling, or completion actions. It never adds or removes database fields, creates documents automatically, or auto-repairs relations.

### Current page status

| Page | Status |
| --- | --- |
| All | Implemented: database loading, hierarchy browsing, status filters, editable details, and post-write verification |
| Week | Implemented: actual seven-day dates, executable backlog, active date-window reminders, and schedule controls |
| Inbox | Implemented: name-only capture, inbox listing, detail navigation, and automatic Inbox status |
| Review | Implemented: five-step checks, issue counts, per-item prioritization, and detail navigation |

Main navigation uses page names only and keeps development-state labels out of tab names.

## Expected fields

The primary field is `工作项`. Xingzhou also recognizes `工作项类型`, `状态`, `上层工作项`, `所属顶层项目`, `本次行动细则`, `下一步行动`, `计划日期`, `截止日期`, `预计时长（分钟）`, and `所需精力`. The intended status set is Inbox, Ready, Planned, In Progress, Blocked, Paused, Someday, Completed, Failed, Cancelled, and Abandoned. Legacy values remain readable during migration.

## Development

```bash
pnpm install
pnpm test
pnpm check
pnpm build
```

The production build creates `dist/` and an installable `package.zip`.

## Data and privacy

Xingzhou has no remote service. It accesses only the configured Attribute View through SiYuan’s local API and writes only after explicit capture, detail editing, scheduling, unscheduling, or completion actions. It stores only binding IDs in plugin-private data and is disabled in Publish mode.

## Database migration note

The code supports editable current-action details and the simplified status model, but it never changes the database schema automatically. Existing databases still need a separate `本次行动细则` text field and an explicit migration of legacy status options and native view filters.

## License

[MIT](LICENSE)
