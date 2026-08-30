# Changelog

This file records notable changes to Xingzhou. The default changelog is Chinese; see [CHANGELOG.md](CHANGELOG.md).

## Unreleased

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
