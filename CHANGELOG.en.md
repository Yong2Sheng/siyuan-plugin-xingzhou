# Changelog

This file records notable changes to Xingzhou. The default changelog is Chinese; see [CHANGELOG.md](CHANGELOG.md).

## Unreleased

### Added

- Replaced the Inbox placeholder with name-only capture that submits on Enter.
- New captures are stored as detached rows in the target Attribute View, using the native Quick Inbox view to auto-fill Inbox status.
- Added the inbox list, explicit success/error feedback, post-write verification, item detail navigation, and native database access.
- Added editable item details with post-write verification for title, type, status, dates, duration, energy, and action fields.
- Added Planned semantics: assigning a plan date can move Inbox/Ready items to Planned, but time alone never changes them to In Progress.
- Added derived Today and Overdue badges without overwriting lifecycle status.
- Added full read/write support for current-action details when the database field exists.
- Replaced the Week placeholder with a Monday-to-Sunday view using actual dates and previous/current/next week navigation.
- Added an Unscheduled pool limited to executable Transactions and Ideas, excluding projects and long-term areas.
- Added active plan-to-deadline window reminders for executable items.
- Added week-level scheduling, moving, unscheduling, and direct completion with post-write verification.
- Replaced the Review placeholder with a five-step weekly check for Inbox items, active top-level projects, stale dates, missing action details, and this week's closed items.
- Added per-item review prioritization so the same item appears in only one highest-priority step per pass.

### Changed

- Replaced the “read-only preview” badge with “local database”.
- Simplified editable statuses to Inbox, Ready, Planned, In Progress, Blocked, Paused, Someday, Completed, Failed, Cancelled, and Abandoned, while keeping legacy values readable during migration.
- Shortened the independent-item aggregate label to “All” and listed root items directly beneath it.
- Moved type and status into the unified metadata panel.
- Placed the completion control beside the title, matched its height to the title field, and hid it after completion.
- Replaced the global action-edit mode with independent click-to-edit cards, blur-to-save, Escape cancellation, and Cmd/Ctrl+Enter saving.
- Moved the Week backlog to the left and strengthened the visual separation of scheduled item cards.
- Strengthened Review card boundaries, theme-aware accent rails, spacing, and responsive behavior.

### Fixed

- Fixed Inbox detail navigation so the exact root item is selected in the sidebar and hierarchy pane.
- Fixed stale reactive hierarchy results after Inbox capture.
- Restored the default database block ID when an older settings file contains an empty value.
- Restored text selection in the details pane and clarified that detached items do not require documents.
- Fixed remote action controls and layout shifts caused by the former global action-edit mode.
- Fixed empty grid tracks showing as large grey regions in Review item lists.
- Fixed Review accent rails disappearing when a theme does not define a warning-color token.
- Fixed duplicate Review entries when an item had both stale dates and missing action details.

### Note

- This commit does not migrate database fields, status options, or native view filters automatically.

## 0.1.0 - 2026-08-29

### Added

- SiYuan plugin scaffold and production package build.
- Read-only loading from the native Attribute View’s “全部工作项” view.
- Long-term area, independent item, hierarchy tree, and detail panes.
- All, active project, someday/maybe, and closed filters.
- Active-path expansion and collapse-all controls.
- Current action details, next action, plan date, deadline, duration, and energy display.
- Linked-document and native-database navigation.
- Non-destructive hierarchy validation.
- SiYuan theme tokens, dark-mode compatibility, and responsive layout.
- Attribute View ID and database block ID settings.
- Chinese and English README and changelog files.
- A new skiff, moving-star trail, and gradient-water visual identity, with a theme-aware top-bar icon.
- Main navigation now reads All, Week, Inbox, and Review, with All placed first.
- The workspace now uses a canvas-and-panels layout with clearer separation between the area sidebar, hierarchy tree, and detail pane while continuing to follow SiYuan themes.

### Fixed

- Fixed a blank page caused by a mismatch between the custom tab’s open ID and SiYuan’s registration rule.
- Relaxed mount-container validation and added a mount regression test for broader SiYuan compatibility.
- Added a visible startup error panel so mount failures no longer result in a silent blank page.

### Limitations

- Apart from adding detached Inbox rows, the current release does not modify fields or other cells.
- Week and review pages are placeholders.
- A missing “本次行动细则” field is reported but never created automatically.
