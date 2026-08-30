# Xingzhou · Personal Projects & Tasks

Xingzhou is a SiYuan plugin for managing personal projects with low friction. A native Attribute View remains the single source of truth; the plugin adds a focused interface for browsing and progressively expanding the work that currently needs attention.

> Current version: `0.2.0` (role-aware details and three-state deadlines)

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
- All-page navigation grouped into Areas & Ideas, Top-level Projects, and Independent Transactions, with an uncategorized fallback.
- Full hierarchy expansion in All and active-path expansion with executable items in Active Projects.
- Active-path expansion and collapse-all controls.
- All, active project, someday, and closed filters.
- Direct detail editing for hierarchy, type, status, dates, duration, and energy.
- Role-aware detail layouts for areas, top-level projects, subprojects, tasks, transactions, and ideas, hiding execution-only fields from non-executable roles.
- Derived, read-only top-project display that updates together with explicit direct-parent changes.
- Three-state deadlines: Pending confirmation, None, or a concrete date.
- Global header capture with `Cmd/Ctrl + Shift + I`, without switching to Inbox first.
- Contextual child creation from an area or project with direct parent and derived top project prefilled.
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
- Opens a work-item menu by right-clicking list, tree, card, and detail-title surfaces, then removes the target Attribute View row only after a second confirmation.
- Loading, empty, error, and missing-optional-field states.
- SiYuan theme token and dark-mode support.
- Configurable Attribute View ID and database block ID.

This release writes only after explicit capture, editing, scheduling, unscheduling, completion, or confirmed deletion actions. It never adds or removes database fields, creates documents automatically, or auto-repairs relations. Deleting a bound row keeps its SiYuan document, descendants are never deleted recursively, and remaining relation references are called out before confirmation.

A pre-release audit against the design report found roughly **94%** coverage of the first-release requirements. Remaining work is enhancement-only: persisted tree/default-page preferences, drag-and-drop scheduling, concurrent-edit conflict feedback, precise native-row navigation, automatic document creation, and a hierarchy widget. None of these gaps blocks the capture–review–schedule–execute–reflect loop.

### Current page status

| Page | Status |
| --- | --- |
| All | Implemented: database loading, hierarchy browsing, status filters, editable details, and post-write verification |
| Week | Implemented: actual seven-day dates, executable backlog, active date-window reminders, and schedule controls |
| Inbox | Implemented: name-only capture, inbox listing, detail navigation, and automatic Inbox status |
| Review | Implemented: five-step checks, issue counts, per-item prioritization, and detail navigation |

Main navigation uses page names only and keeps development-state labels out of tab names.

## Expected fields

The primary field is `工作项`. Xingzhou also recognizes `工作项类型`, `状态`, `上层工作项`, `所属顶层项目`, `本次行动细则`, `下一步行动`, `计划日期`, `截止日期`, `无截止日期`, `预计时长（分钟）`, and `所需精力`. Long-term areas use focus-oriented states while other roles use lifecycle states. `无截止日期` is a checkbox that distinguishes an explicit no-deadline decision from an unconfirmed blank. Legacy values remain readable during migration.

## Development

```bash
pnpm install
pnpm test
pnpm check
pnpm build
```

The production build creates `dist/` and an installable `package.zip`.

## Data and privacy

Xingzhou has no remote service. It accesses only the configured Attribute View through SiYuan’s local API and writes only after explicit capture, detail editing, scheduling, unscheduling, completion, or confirmed deletion actions. It stores only binding IDs in plugin-private data and is disabled in Publish mode.

## Database schema note

Xingzhou never changes the database schema automatically. Before first use, ensure that the target Attribute View contains the fields you intend to use, especially the `本次行动细则` text field and the `无截止日期` checkbox. Legacy statuses remain readable, but moving gradually to the current status set and reviewing native view filters is recommended.

## License

[MIT](LICENSE)
