# Changelog

This file records notable changes to Xingzhou. The default changelog is Chinese; see [CHANGELOG.md](CHANGELOG.md).

## Unreleased

### Added

- Added Free arrangement for bedtime, allowing users to intentionally skip bedtime preparation and a planned lights-off value while still recording actual sleep the next morning.
- Added Same evening / Next day selection for planned lights-off and persist the resulting full local date-time, removing ambiguity after midnight.

### Changed

- After-hours work and anomaly/observation prompts in the 21:00 review now use Pending / No / Yes decisions. Explanation fields appear only for Yes, while No clears details that no longer apply.
- Closure next steps now use Pending / No / Yes; the next-step text field appears only when Yes is selected.
- Reworked the two-column 21:00 and bedtime layouts so paired decisions, conditional details, and lights-off date/time controls remain aligned.

### Compatibility

- Existing after-hours reasons, anomaly observations, and closure next-step text are inferred as Yes; legacy placeholders such as “none” are normalized to explicit No states.
- Existing planned lights-off times gain a date using nighttime semantics: before midnight means the same evening, while after midnight means the next day.

## 0.7.0 - 2026-09-04

### Added

- Added execution slices for Transactions. Set a target count and per-slice estimate, then schedule each slice independently from the detail calendar without creating child work items.
- Added Scheduled, Completed, Missed, and Abandoned slice states. Progress is the percentage of target slices completed; missed and abandoned attempts remain in history while releasing a replacement slot.
- Week now presents explicitly scheduled slices and supports completion and undo. Slice-enabled transactions are no longer duplicated mechanically across every date from planned start through deadline.
- Life Rhythm automatically displays personal slices scheduled for the current date and can add a same-day slice from an in-progress transaction with immediate synchronization back to Projects & Tasks.
- Transactions without a deadline can schedule and move slices from today onward; when present, a deadline remains the latest allowed date.

### Changed

- Daily records now use debounced autosave. Pending edits are flushed before changing dates, stages, or top-level modules; a failed save keeps the current view available for retry.
- Research workdays now follow five stages: Morning, After lunch, Clock-out, After work, and 21:00. Clock-out contains boundary and status evaluation, while After work contains closure and personal tasks.
- Training completion moved to Morning before training details. Details appear only when training is marked complete and are cleared when marked incomplete or as a rest day.
- Returning from Life Rhythm restores the previous Projects & Tasks page, filters, hierarchy scope and expansion, selected work item, and scroll position. Links from daily tasks still focus their exact target.
- Stabilized responsive widths and alignment for time, score, weight, personal-task, and result controls throughout Life Rhythm.

### Fixed

- Fixed the calendar remaining disabled after saving a slice count and eliminated transient calendar/detail layout shifts while scheduling.
- Fixed controlled result selectors failing to show their first selection and removed layout movement caused by a temporary score-clear button.
- Fixed the daily personal-task picker using a different order from hierarchy browsing, and fixed module switching unexpectedly selecting an item or narrowing the hierarchy to one area.
- Fixed execution-slice calendars being unavailable for transactions without a deadline.

## 0.6.0 - 2026-09-03

### Added

- Added per-row Up and Down controls plus drag handles for persistent manual sibling ordering in the hierarchy browser.
- Changed Week completion to per-date records: completing one dated card no longer closes the other dates or the whole work item. Completed dates remain visible, can be undone, and stay available in historical weeks after the item itself is closed.
- Added Life Rhythm as a top-level module beside Projects & Tasks; All, Week, Inbox, and Review remain second-level project views.
- Added Today, History, Rubrics, and Timeline views with research-workday, Saturday-reset, Sunday-half-day, and holiday profiles.
- Added staged daily forms, hour/minute selectors, kg/lb weight units, automatic work-boundary evaluation, and five in-context scoring rubrics.
- Added Pending / Not needed / Needed states for optional after-work closure. Detail fields appear only when needed, and not-needed durations are stored as null rather than zero.
- Added a separate `daily-records.json` with three rotating backups and read-after-write verification. It starts empty and never migrates the old daily document.
- Added read-only date-range and rubric interfaces for future weekly, monthly, and AI analysis.
- Week now shows work items across their full planned-start-to-deadline interval, distinguishing Start, Ongoing, Deadline, Carry-over, and Continues-next-week states. Weekly totals remain deduplicated by work item, estimated duration is shown only on the start day, and multi-day start dates can only be changed from the first card without crossing the deadline.
- Hierarchy browsing now highlights work that starts today, ends today, or spans today, and rolls the count up through its project path while retaining the original lifecycle status in a quieter style.
- Current Action Details and Next Action now render basic Markdown directly through SiYuan's Lute renderer while not being edited, including headings, emphasis, lists, blockquotes, code, links, tables, and task lists, while preserving ordinary text line breaks. Editing and storage continue to use the original Markdown text.
- Action text editors now continue numbered, bulleted, and task lists automatically. Pressing Enter again on an empty list item exits the list.
- Action text editors now expand to fit their full content on entry and continue adapting after content or window-width changes, preventing a sudden size drop between viewing and editing.

### Fixed

- Improved Life Rhythm typography, responsive control widths, and column alignment so time, score, and weight controls no longer stretch awkwardly on wide windows.
- Lights-off and wake values now retain explicit dates for cross-day sleep. Also corrected the placement of actual work-end time, watch sleep score, and rubric links.
- Fixed the first Key Work Result selection still appearing blank, and made a second click on an active score clear it without inserting a layout-shifting button.
- Fixed SiYuan's internal block ID attribute marker appearing in rendered Markdown previews.
- Fixed ordered-list source numbers diverging from the rendered result after inserting or deleting an item. Following sibling numbers now normalize immediately after typing, deletion, cutting, or pasting.

## 0.5.0 - 2026-09-02

### Added

- Xingzhou now stores complete work items in plugin-managed internal storage. A legacy SiYuan Attribute View is read only once as an optional migration source.
- Migration preserves fields, hierarchy, linked-document references, and cross-project dependencies, and creates a private migration snapshot.
- Every mutation rotates three private backups and verifies the saved store by reading it back. A corrupt primary store recovers from the newest valid backup.
- Added cross-project dependencies independent of the hierarchy. `完成后开始` (hard prerequisite) and `需先行` (should stay ahead) are stored directly by the plugin and require no database fields.
- Added dependency editing, reverse references, tree indicators, unfinished hard-prerequisite hints, cycle prevention, and deletion warnings without automatically changing work-item status.

### Changed

- Capture, editing, scheduling, completion, and deletion no longer write to the legacy Attribute View. Once migrated, deleting that view or its containing document does not remove Xingzhou's work items.

### Fixed

- Correctly treats SiYuan's empty-object response for a missing plugin data file as first-run state instead of corruption.

## 0.4.0 - 2026-09-01

### Changed

- Removed Planned from selectable execution statuses and clarified the `计划日期` UI label as Planned Start Date.
- Future starts now show a subtle Scheduled hint; Ready and legacy Planned items automatically become In Progress when their start date arrives, while blocked, paused, and closed states remain untouched.
- Legacy Planned values remain readable and are normalized to Ready or In Progress according to their planned start date.
- Review no longer treats a past planned start as stale, preventing normal multi-day work from being repeatedly flagged.
- Inbox is now a triage-only stage and no longer appears among project or execution status options; contextually created and classified items start as Ready.
- Added upward hierarchy progression: any In Progress descendant promotes project ancestors still in Inbox/Ready, without overriding areas or explicit paused, blocked, someday, and closed states, and without automatic demotion.

### Fixed

- Prevented executable items already scheduled in the visible week from appearing again in the left-side Active Window; unscheduled items and cross-week window reminders remain unchanged.
- Prevented narrow sidebar cards from wrapping statuses such as Completed into vertical character stacks.

### Added

- Added a persisted Include Closed toggle beside the top filters. All hides closed items by default, while the dedicated Closed filter always shows the complete result.
- Preserved closed ancestors required as hierarchy context for open descendants when closed items are hidden.

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
