# Changelog

This file records notable changes to Xingzhou. The default changelog is Chinese; see [CHANGELOG.md](CHANGELOG.md).

## Unreleased

### Changed

- Removed Planned from selectable execution statuses and clarified the `计划日期` UI label as Planned Start Date.
- Future starts now show a subtle Scheduled hint; Ready and legacy Planned items automatically become In Progress when their start date arrives, while blocked, paused, and closed states remain untouched.
- Legacy Planned values remain readable and are normalized to Ready or In Progress according to their planned start date.
- Review no longer treats a past planned start as stale, preventing normal multi-day work from being repeatedly flagged.
- Inbox is now a triage-only stage and no longer appears among project or execution status options; contextually created and classified items start as Ready.
- Added upward hierarchy progression: any In Progress descendant promotes project ancestors still in Inbox/Ready, without overriding areas or explicit paused, blocked, someday, and closed states, and without automatic demotion.

### Fixed

- Prevented executable items already scheduled in the visible week from appearing again in the left-side Active Window; unscheduled items and cross-week window reminders remain unchanged.

## 0.3.0 - 2026-08-31

This release turns creation, hierarchy recognition, and completion into a clearer workflow that feels native to SiYuan.

### Added

- Added a global “+ Add” entry in the header, available from All, Week, Inbox, and Review, with `Cmd/Ctrl + Shift + I` support.
- Added contextual child creation from area/project details and native context menus, prefilling the direct parent and derived top project.
- Added compact `+` actions to all three sidebar groups for creating an area/idea, a top-level project with an optional area, or an independent transaction.

### Changed

- Removed the redundant all-items sidebar entry and grouped All-page navigation into Areas & Ideas, Top-level Projects, and Independent Transactions, with an uncategorized fallback when needed.
- Made All expand the full hierarchy by default, while Active Projects exposes executable items along active paths.
- Replaced the custom creation overlay with SiYuan's native `Dialog`, removing the GPU-heavy live backdrop blur and inheriting native form, button, theme, and window behavior.
- Replaced the misleading project-only selector in Top-level Project creation with an explicit distinction between the top-level role and the underlying Project database type.
- Replaced redundant hierarchy dots with colored text role badges, sharing one label and palette across the hierarchy legend, middle tree, and detail pane.
- Moved the completion shortcut into the role row, renamed it to “Mark as completed,” and restyled it as a soft green secondary action so it cannot be mistaken for title-edit confirmation; an eight-second Undo action follows completion.

### Fixed

- Kept the current area or project scope after creating a descendant inside it, instead of forcing navigation to the new item's direct parent.

## 0.2.0 - 2026-08-30

The detail view now exposes only information applicable to each work-item role, while deadlines explicitly distinguish Pending, None, and a concrete date.

### Changed

- Switched the work-item context menu to SiYuan's native `Menu`, matching the task center's icon, warning action, hover behavior, theme, and dark-mode treatment.
- Made the detail view role-aware so areas, top-level projects, subprojects, tasks, transactions, and ideas expose only applicable fields.
- Derived the top project from the direct-parent chain, displayed it read-only, and updated it together with explicit parent changes.

### Added

- Added `无截止日期` checkbox support and a Pending / None / Concrete date deadline control. Review warns about unconfirmed deadlines but skips explicitly deadline-free items.

## 0.1.1 - 2026-08-30

Adds a protected work-item deletion flow on top of the first public testing release.

### Added

- Added one consistent right-click menu across All, Inbox, Week, and Review work-item surfaces for deleting areas, projects, tasks, transactions, and ideas.
- Added a second confirmation with explicit warnings when descendants or top-project references remain.

### Safety

- Deletion removes only the target Attribute View row. A bound SiYuan document is merely unbound and is never deleted.
- Descendants are not deleted recursively, relation references are not silently rewritten, and the Attribute View is reloaded to verify every deletion.

## 0.1.0 - 2026-08-30

The first complete release for real-world use and continued testing. A pre-release audit against the design report found roughly 94% coverage of the first-release requirements.

### Added

- Created the SiYuan plugin project, installable package, bilingual documentation, and the skiff–moving-star–gradient-water visual identity.
- Kept the native Attribute View as the single source of truth and implemented four primary pages: All, Week, Inbox, and Review.
- Added long-term areas, project hierarchy, independent items, active-path expansion, collapse-all, and All/Active Projects/Someday/Closed filters.
- Added direct editing with post-write verification for title, type, status, parent, top project, dates, duration, and energy.
- Added independent click-to-edit Current Action and Next Action cards with blur-to-save, Escape cancellation, and Cmd/Ctrl+Enter saving.
- Added name-only capture, Inbox listing, success/error feedback, and detached database-row details.
- Added an actual-date Week page with previous/current/next navigation, an executable backlog, active date-window reminders, moving, unscheduling, and quick completion.
- Added a five-step weekly Review covering Inbox, active top-level projects, action details, stale dates, and this week's results, with per-item priority deduplication.
- Added Planned semantics and derived Today/Overdue hints without allowing dates to overwrite actual progress.
- Added linked-document/native-database navigation and non-destructive hierarchy validation.
- Added SiYuan theme tokens, dark-mode and narrow-layout support, plus Attribute View and database block settings.

### Changed

- Unified editable statuses as Inbox, Ready, Planned, In Progress, Blocked, Paused, Someday, Completed, Failed, Cancelled, and Abandoned while preserving legacy reads.
- Moved type and status into the metadata panel; placed the equal-height completion control beside the title and hid it after completion.
- Put the Week backlog on the far left and limited it to unscheduled executable Transactions and Ideas.
- Limited dated Week columns to unfinished items; completed work is summarized by the Review page instead.
- Strengthened panel and card boundaries, fills, shadows, and theme-aware accent rails.
- Standardized concise All and Someday labels across navigation and filters.

### Fixed

- Fixed silent blank pages caused by custom-tab registration and overly strict mount-container checks.
- Fixed exact Inbox detail selection and stale hierarchy results after capture.
- Restored the default database block ID when older settings contain an empty value.
- Restored text selection in details and clarified that detached items do not require documents.
- Fixed action-editor layout shifts, empty Review grid tracks, and missing accent rails in themes without warning tokens.
- Fixed duplicate Review entries when one item had both stale dates and missing action details.

### Known limitations

- Xingzhou never creates, removes, or migrates database fields or status options automatically.
- Tree expansion and default-page preferences are not persisted yet.
- Drag-and-drop scheduling, concurrent-edit conflict feedback, precise native-row navigation, automatic document creation, and a hierarchy widget are not included.
