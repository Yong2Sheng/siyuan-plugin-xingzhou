# Changelog

This file records notable changes to Xingzhou. The default changelog is Chinese; see [CHANGELOG.md](CHANGELOG.md).

## 2.2.0 - 2026-09-12

### Added

- Execution slices support **undoing a completion**, today is marked with **今**, and **filling every target slice no longer ends the transaction by itself** (correcting the 2.1.0 behaviour): clicking a completed cell or using its context menu undoes it — today returns to Scheduled, a past date to Missed, a transaction you marked Done by hand falls back to In Progress, and abandoned slices stay read-only. With every target slice done the calendar only asks "Target slices are all done — is the transaction done too?", and the state changes when you press Complete transaction. Today's cell shows 今 on the same line as the date, so the marker costs no extra height.
- Hierarchy browsing (the All page) gained a **Today view** in the filter group (first position, with a badge counting today's slots, and with the count of transactions that still have unfinished slices today): only transactions that still have unfinished execution slices today stay visible, so nothing else competes for attention. A matching transaction keeps its full area → project → task → transaction path as context, while only the transaction itself carries the blue Today marker; the sidebar scope groups, the toolbar toggles, and expand/collapse all follow the filter. The list previously only had the inline Today marker with no matching filter entry; both now share one rule (`isTodayFocusItem`), so the marker and the filter can never disagree.
- The Today view is remembered with the rest of the view state: reopening the plugin returns to the filter you left (the filter allow-list in `ui-state.json` was extended to match).
- Images in Current Action Details gained a **context menu**: right-click a thumbnail, an image in the read-mode text, or the enlarged original in the preview dialog to **Copy original image** or **Copy asset path**.
  - Copy original image writes the **original file bytes** from the SiYuan asset library: a PNG screenshot is never decoded or resampled, so size and pixels match the image you originally pasted. It can be pasted straight into an AI conversation for pixel-level comparison instead of taking a new screenshot (which loses resolution).
  - Non-PNG images (jpg / webp / gif / svg) are transcoded to PNG at their original size first: only the container changes, never the pixels, and an animated GIF keeps its first frame.
  - The confirmation carries size and pixel dimensions (for example "Copied original image · 1280×800 · 611 KB"), and an unavailable clipboard, an unreadable asset, or a failed transcode each report their own reason instead of failing silently.
  - Copy asset path copies `assets/...` as text so the same image can be referenced in prose. Only the image itself is a hit target: the size badge and the "×" remove button do not open the menu.

### Changed

- **Cancelling today's slice no longer jumps to another transaction.** Previously, clearing today's cell in the detail pane dropped the transaction out of the filter immediately, and the UI switched you to another transaction (most unfinished slices today, then tree order) — while the slice calendar reset to the current month when the transaction changed, so the view looked almost identical and inviting repeated clicks. The selection is now **pinned in place**: the transaction and its ancestor path stay visible with a "moved out of today" marker (hover explains why), the detail pane and calendar never switch items, and you can schedule the slice back onto today to restore it. The pin is released only when you actively select another item, switch filter or scope, or delete the item; after a deletion the original fallback still applies.
- The slice card's **information block lost a full row**: when the card is wide enough (≥620px) the scheduling note and the Complete / Abandon this slice actions merge into the "0% transaction progress + progress bar" row; on narrower cards they sit on the row under the bar, but the buttons always stay on the same line as the note instead of wrapping or jumping with width or state changes. Buttons shrank from 30px to 22px (3px padding plus a 14px line height), and a long note is truncated with an ellipsis and shown in full on hover.
- Slice-card copy now states facts: with a slice scheduled today it reads **"1 slice scheduled today"**, and the previous "unhandled by the end of today is automatically recorded as missed" is gone — that sentence never said whether it meant the transaction or the slice, and its timing was inaccurate (past-dated slices are settled on the next load, and only the slice status changes, never the transaction).
- Keeping a selection in hierarchy browsing no longer inserts an explanation banner or rewrites the panel subtitle: the banner appearing and disappearing was itself shifting the tree, so the explanation now lives in the hover text of the "moved out of today" marker.

### Fixed

- Fixed the buttons jumping to the next line: the note and the buttons used to switch between side-by-side and stacked based on container width, so resizing the window moved the buttons. The layout no longer switches within a tier.
- Fixed detail thumbnails **always collapsing to one per row**: when the container content box is ≤620px wide the thumbnail width is `calc(50% - 4px)`, and adding the 1px border made the real outer box `50% - 2px`, so two thumbnails plus the 8px gap exceeded 100% and every image ended up on its own line. At a 1440px pane the detail content box is exactly 568px, which is inside that range, so this was the everyday path. Measuring against `border-box` now restores two per row (both the `132×96` and `calc(50% - 4px) × 88` tiers render at their declared size), guarded by a layout-invariant test.

## 2.1.0 - 2026-09-11

### Added

- **A transaction is complete once its target slices are done**: finishing the last slice now completes the transaction itself — the This Week board's Complete / Backfill complete / Complete early buttons, the slice calendar and today actions in the transaction detail, and Complete in Life Rhythm's Today's personal schedule all share one rule, so you no longer have to reopen the detail and press Complete transaction; undoing a slice completion that drops the item below its target moves it back to In Progress. Transactions that already ended (Done / Failed / Cancelled / Abandoned) are never rewritten by slice actions.
- Each row in Life Rhythm's Today's personal schedule gained **Cancel arrangement**: it removes only today's slice and leaves the transaction itself untouched; the row disappears immediately and the daily record's personal-schedule snapshot is updated with it.
- Actual lights-off gained a **bedtime band** selector (before midnight / after midnight · stayed up), shown inside the label row and vertically centred with the label:
  - After midnight can be recorded with one click and **without inventing an exact minute**: the time row turns into "no exact time", and "Add time" expands it when you do know;
  - When a time is filled in, the band is derived from it (an after-midnight clock time means after midnight), and the conflicting band is disabled so contradictory values cannot be stored;
  - Clearing a stored time only happens when you press "Clear" yourself; the band marker survives and the field returns to "no exact time";
  - The history list shows a "stayed up" badge after sleep duration, and the missing-field check accepts the after-midnight marker instead of asking for a time forever.
- The bedtime band is stored next to the exact time. Records written by earlier versions have no such field and get it derived from their existing time; revision numbers, rotating backups and read-after-write verification are unchanged.

### Changed

- Rows in Today's personal schedule now show the transaction's own end state: when the transaction is Done / Failed / Cancelled / Abandoned the **row stays visible** with a "Transaction done / Transaction cancelled" badge and its Complete, Abandon and Cancel arrangement actions are disabled, so a cancelled transaction can no longer look pending and actionable.
- The Today's personal schedule box switched from a fixed 76px height to an **adaptive** one: about three rows at minimum, then in-box scrolling past roughly five rows. The empty state matches the height of a filled one, so adding or cancelling an arrangement no longer makes the section jump.

### Fixed

- Fixed slice actions bypassing image-cleanup registration: when a slice completes its transaction, the images are registered for cleanup exactly like Mark as complete; undoing the completion back to In Progress clears that registration.
- Fixed daily-record form controls being **22px wider than their own grid column**: they were sized as content-box, so `width:100%` was followed by another horizontal padding and border. At a 1440px window "the most important work today" overlapped the right column's "Adjustment details" by 12×94px, and at 1100px the watch sleep score input pushed into the neighbouring column. Inputs, selects and textareas now use `border-box`, so control edges line up with column edges.
- Fixed the actual-lights-off label sitting 3px lower than the other labels in the same grid row because of the selector next to it.

- **Correction (later version)**: the "a transaction is complete once its target slices are done" rule above was changed back to **your confirmation** — filling every target slice no longer ends the transaction by itself, the slice calendar only asks "Target slices are all done — is the transaction done too?", and the state changes when you press Complete transaction. The detail slice calendar also gained an **undo** entry (click a completed cell or use its context menu: today returns to Scheduled, a past date to Missed, and a transaction you had marked Done by hand falls back to In Progress). The undo side of the rule shipped here (falling back to In Progress when the item is no longer full) is still in place. See the 2.2.0 section.

## 2.0.0 - 2026-09-10

### Added

- Images in the current-action field: paste a screenshot (Cmd/Ctrl+V) or drop an image file on the card. Images are stored in the SiYuan asset library at **original resolution** (no re-encoding, no compression); the action text keeps only an `assets/...` path reference, so image bytes never enter the plugin data.
- Images are named after their content fingerprint and de-duplicated: pasting the same image twice stores one copy, and the SiYuan kernel itself reuses existing assets by content.
- Edit mode shows thumbnails below the input: a spinner while uploading, red state on failure, a size badge, and per-image removal. Read mode renders images through Lute, capped in height, and clicking one opens the original.
- When an item ends (Done / Failed / Cancelled / Abandoned) its images are registered for cleanup: the item plus all its descendants are queued with a 7-day grace period. During the grace period text and images stay untouched, and the item shows a "image cleanup · N days left" badge.
- New "Image cleanup" page (toolbar entry with a count badge):
  - Lists every pending item with thumbnails, image count, status and countdown; due items sort first and are highlighted;
  - "Clean up now" opens an in-page confirmation step to pick items and individual images; images still referenced by other unfinished items are marked with the referencing item and cannot be selected;
  - After confirmation, Xingzhou removes its own references first, then checks SiYuan's "unreferenced assets" list and deletes only files SiYuan considers unused. Images referenced by documents, databases or other plugins are always kept;
  - Deletion goes through SiYuan's single-asset API, which copies the file into the history folder first, so it can be recovered from History. The result (deleted, kept, failures) is shown on the page.
- New "Storage health" section: counts distinct images referenced by Xingzhou, space used by unfinished items, space pending cleanup, and the whole asset library, with a segmented usage bar and a per-item usage ranking (collapsible, top 20). Sizes are queried through SiYuan's asset API, cached, and can be refreshed manually.

### Changed

- The cleanup entry moved from an always-visible panel under the toolbar to a toolbar button plus a dedicated page: it no longer consumes vertical space and is no longer constrained by dialog width.
- Cleanup confirmation moved from a dialog into a second in-page step; the checkbox sits above the thumbnail with a fixed "Delete / Cannot delete" label, and clicking the thumbnail toggles deletion too.
- Thumbnails are shown complete and in their original aspect ratio (no cropping, no stretching), so tall screenshots stay readable.
- View state now remembers the cleanup page, so reopening Xingzhou returns to it.

### Fixed

- Fixed a missing field on newly created items that made **every write fail the integrity re-check**: `addStoredWorkItem` now initialises `imageCleanup` explicitly so written and re-read data match. The error message now reports the first differing position when a re-check fails.
- Fixed several image interaction defects:
  - Pasting several images in a row inserted the next one into the middle of the previous image syntax and split it (cursor offset computed in the wrong direction);
  - Blank lines appeared between consecutive images;
  - Removing a thumbnail did not refresh the list because the Svelte dependency sat inside a `map` callback and was not tracked;
  - Blurring while an upload was still running could save a half-finished path; it now refuses and removes the placeholder;
  - Switching items before an upload finished could write the result into the new item (stale-draft and ownership checks added);
  - The placeholder pattern missed the form that carries a file name, so a successful upload was not substituted back;
  - Unchecking an image made it impossible to select again (selection was derived instead of tracked); selection is now maintained independently;
  - "Cannot delete" was wrongly shown because deletability was coupled to selection; it now depends only on whether another unfinished item references the image.

## 1.3.0 - 2026-09-09

### Added

- The Execution Slice calendar and the Week page now show a "To do" duration: the total length of slices still scheduled (not yet finished) on that day. When everything committed for a day is done or finished early, the cell shows a green "To do 0 min" and the whole cell turns green, so it is obvious the day is free for other transactions; the original "Total X min · N slices" (scheduled + completed) stays beside it, and reading the two together rules out mistaking "To do" for free capacity.
- The Execution Slice calendar header gained a summary row and a wording legend (outstanding total from today, committed total, and how many whole days are cleared), explaining that "To do = slices scheduled for that day that are not finished yet".
- Reopening Xingzhou now restores the previous Projects & Tasks view state (page, filters, hierarchy expansion, selected transaction, and scroll position). If the previously selected item is completed or hidden, the selection falls back deterministically to the transaction with the most unfinished slices today (ties by tree order), otherwise to the first visible transaction in tree order.
- Life Rhythm's morning Today Plan now shows a read-only hint: the “first action when work starts tomorrow” written in the previous evening's 21:00 review appears automatically the next morning for reference. The hint is not editable and stays hidden when the previous day's note is missing or empty.
- Life Rhythm's personal-task note now asks Yes/No first: the text box appears only for Yes, and choosing No collapses it without holding any height. The same decision applies in all four places: research workday / Sunday half-day, Saturday, holiday, and Conference Day after the meeting.

### Changed

- Execution Slice calendar days now use a two-line time block: "To do X min" on the first line and "Total X min · N slices" on the second. Past dates show only "Total" (pending work no longer means anything there; missed slices are still shown by the red dot, red border and the "missed" wording). Slices without an estimate render "To do unestimated", and partially estimated days render "To do ≥X min".
- Day cells adapt to their container width: a wide cell reads "To do 240 min", a medium one drops the spaces around the number ("To do 240min"), and the narrowest (~41px) drops the unit from the first line and keeps it on the "Total 240min" line, so no width ever shows a bare number.
- The Week page date row is now three fixed slots: weekday + date on the left, a slot reserved for "Today" in the middle (empty on other days), and the "To do" chip always flush right, so the chip no longer jumps between middle and right. Narrow columns drop the "min" unit from the chip and restore it when the window widens.
- Removed the hover tooltips from execution slice day cells and the week-board "To do" chip (screen-reader labels keep the full wording), and deleted the "this transaction: N slices · M done" line that could never appear: a transaction may hold only one slice per day, enforced when scheduling and moving.
- Reshaped the color system of hierarchy browsing: type badges use a calm Morandi low-saturation palette (gray-khaki, gray-green, gray-teal, gray-blue, terracotta, gray-purple), while status and slice indicator chips use a vivid summer palette (vivid green for ongoing, sky blue for pending, vivid orange for focused, bright yellow for paused, turquoise for future, vivid indigo for maintaining, vivid red for blocked, bright amber for needs-scheduling, deep blue for arranged/today, gray for terminal states), all as square chips with a colored outline and a 3px left color bar. Shape and color temperament now separate the two dimensions, so type and status can no longer be confused.
- The Life Rhythm top toolbar is now left-aligned: the date navigation and the six view-switcher buttons sit side by side on the left with blank space on the right, reducing pointer travel on wide screens. Narrow screens still stack them vertically.
- Compressed the Transaction Execution Slices card vertically: the header now fits on one line (the “slices are not work items” note moved into an ⓘ hover hint), and the completion percentage sits on the same row as the progress bar and the planning summary, wasting no space on small screens.
- The Target Slice Count label now states the 366 input cap, making it clear that a single transaction can hold at most 366 slices.
- Reworked the personal-task area into a left column holding the decision plus the box it opens, and a right column holding today's personal schedule, so the Yes/No selector and its text box sit directly above and below each other instead of one spanning the row and the other landing at the bottom right. Choosing No saves an empty note but keeps the text as a draft that comes back when Yes is chosen again, and notes already stored by earlier versions are recognized as Yes so they are never hidden.

## 1.2.0 - 2026-09-08

### Added

- Added a Conference Day profile for conferences, talks, and collaborative meetings. It does not assume free time before the event ends, asks whether personal tasks should be scheduled afterward, and explicitly skips nutrition logging for that day.
- Added Partial and Missed outcomes to Daily Checklist, forming a four-state flow with Pending and Completed. Partial outcomes contribute half credit, while legacy checks remain Completed.
- Added an automatically generated Relationship Graph under Projects & Tasks. It shows unfinished projects and transactions with their long-term-area context, hierarchy links, hard prerequisites, and should-stay-ahead relationships.
- Added transaction slice indicators to hierarchy browsing: Not configured, N to schedule, X/Y scheduled, and X/Y completed.
- Added context-menu completion actions to transaction calendars: complete future slices early, complete today's slice, or correct a missed past slice. The keyboard Context Menu key and Shift+F10 are supported as well.
- Added explicit Yes/No availability decisions before Watch Sleep Score and Morning Weight, so days without a watch or scale no longer appear incomplete.

### Changed

- The Today badge now appears only on Transactions that still have an unfinished slice today. It disappears after completion and no longer rolls up to area or project ancestors. Ongoing, Focused, and Today indicators use green, red, and blue respectively.
- Dependency pickers now list only Ready and In Progress transaction candidates, reducing noise from closed or currently irrelevant work items.
- Completing a future slice early now preserves its planned date and the one-slice-per-transaction-per-day scheduling rule. Week also shows a separate achievement on the actual completion date without counting it as that day's scheduled workload.
- Relationship edges now use explicit directional labels such as “A completed → B starts” and “A stays ahead → B.” Node spacing, related-item highlighting, blank-canvas clearing, and inspector typography were also refined.
- Reworked the Research Workday Today Plan layout: work start and planned end remain in one left-hand row, while adjustments and their conditional details stay aligned on the right.

### Fixed

- Fixed the Relationship Graph rendering an empty canvas despite loaded data, overlapping dependency arrows, ambiguous edge direction, and status pills that diverged from the intended design.
- Fixed Complete Early in Week doing nothing or removing the planned card. The original date now retains a completed card while the actual completion date receives a separate achievement.
- Fixed transaction calendars showing only one visual slice while reporting confusing totals when legacy data contains multiple slices for the same transaction and date. The day cell now reports both slice and completed counts.
- Fixed stale Life Rhythm stage status and layout shifts after conditional Today Plan fields appeared.

### Compatibility

- No manual migration is required for work items, execution slices, Life Rhythm, Checklist, or nutrition data, and existing planned slice dates are not rewritten.
- Legacy Checklist `checkedKeys` are normalized to Completed. Existing sleep-score and weight values are used to infer their new availability decisions.

## 1.1.0 - 2026-09-06

### Changed

- Professional study after lunch now begins with a No / Yes decision. Book, topic, plan, and result fields appear only when study is planned, and explicitly selecting No clears details that no longer apply.
- Today's Life Rhythm record now shows stage completeness and a missing-fields review. Free-form navigation remains available, stage buttons distinguish not started, incomplete, complete, and no-check-needed states, and each key omission can jump to and focus its field; ordinary notes remain optional.
- The nutrition manager now separates Daily Goals and Food Templates into distinct cards: side by side on wide panes and stacked on tablets or narrow panes, making goal settings clearly separate from template entry.
- Removed the redundant global Add button, Inbox navigation, standalone Inbox page, and Inbox review step. New items now come from typed creation entry points and default to Ready, while legacy Inbox-status data remains visible in All for compatibility.
- Split the Review investment check into Focused long-term areas and Ongoing top-level projects, clearly separating what matters now from what is actively being done.
- Persisted Checklist completion and weekend training/rest choices by date, so progress now survives plugin restarts and device sync without requiring migration of existing templates.
- Made Today's Intake an independently scrollable region with a persistent header. Desktop panes now use the available viewport height, while tablet single-column layouts keep a tighter cap so long entry lists do not stretch the entire page.
- Restored execution-slice completion actions in Week: today's slices can be completed or abandoned, missed past slices can be corrected as completed, and future slices can be completed early by atomically moving them to today.

## 1.0.0 - 2026-09-06

### Added

- Added a standalone Nutrition Intake page to Life Rhythm, totaling calories, protein, carbohydrates, and fat by day without requiring meal categories.
- Added optional daily calorie and protein goals with progress, remaining allowance, and over-target feedback. Carbohydrates and fat remain secondary metrics, with approximate macro calorie shares calculated at 4/4/9 kcal per gram.
- Added user-defined food templates with create, edit, and delete flows. A template can be logged instantly at its base amount or recorded with a temporary actual weight, volume, or quantity; all four nutrition values scale proportionally.
- Daily entries expose their actual consumed amount directly, with unit-aware adjustment steps. Editing or deleting a template never rewrites historical nutrition snapshots.
- Nutrition uses an independent `nutrition.json` store protected by revisions, three rotating backups, read-after-write verification, and corruption recovery.
- Every execution-slice calendar now shows the number of scheduled slices and estimated minutes per day, making workload visible before adding another slice. Compact layouts prioritize estimated time.

### Changed

- Compacted the plugin header while preserving the original Projects & Tasks / Life Rhythm button styling and leaving the existing content UI intact.
- Consolidated total investment, the status legend, same-day guidance, and slice actions into a tighter execution-slice header, and reduced the gap between configuration and the calendar.
- Redesigned responsive behavior for tablets and narrow panes: detail fields wrap predictably, hierarchy rows waste less width, and Nutrition switches by actual pane width between two-column, single-column, and bottom-sheet amount layouts.
- Enlarged touch targets while retaining keyboard, trackpad, context-menu, and desktop-density behavior.
- Completing an execution slice can now promote an unstarted transaction to In Progress without overriding paused, blocked, or closed states.

### Fixed

- Increased execution-calendar text, border, and workload contrast, and fixed side guidance consuming most of the usable calendar width on tablets.
- Fixed compressed detail fields, Deadline / Required Energy misalignment, and hierarchy titles being reduced to only one or two visible characters on HarmonyOS tablets.
- Restored left alignment for transaction detail titles and kept overflow-menu and touch operations available in narrow panes.
- Fixed existing execution records incorrectly preventing a deadline from being cleared. Saving is blocked only when a new concrete deadline would precede an existing slice.

### Compatibility

- Upgrading creates `nutrition.json` on first use and does not read or modify any SiYuan document to derive nutrition data.
- Legacy nutrition templates and entries using servings / serving descriptions are normalized on read into equivalent base amounts, units, and consumed amounts.

## 0.8.0 - 2026-09-05

### Added

- Added a standalone Daily Checklist page under Life Rhythm with the same workday, Saturday, and Sunday reminders as the paper edition, excluding fields that previously required handwriting.
- Added shared Xingzhou and Paper views. Both use the same templates and same-day checks, remember the preferred view, and always use the paper layout for printing.
- Checklist time nodes, titles, reminder text, and paper-section styling are editable. Time nodes can also be added, removed, and reordered; configuration uses its own file with three rotating backups and read-after-write verification.
- Checklist checks are temporary, date-scoped session state and never enter history. Switching views or modules keeps them, while moving to a new date clears the old state.
- Added Free arrangement for bedtime, allowing users to intentionally skip bedtime preparation and a planned lights-off value while still recording actual sleep the next morning.
- Added Same evening / Next day selection for planned lights-off and persist the resulting full local date-time, removing ambiguity after midnight.

### Changed

- After-hours work and anomaly/observation prompts in the 21:00 review now use Pending / No / Yes decisions. Explanation fields appear only for Yes, while No clears details that no longer apply.
- Closure next steps now use Pending / No / Yes; the next-step text field appears only when Yes is selected.
- Reworked the two-column 21:00 and bedtime layouts so paired decisions, conditional details, and lights-off date/time controls remain aligned.
- Life Rhythm now places Daily Checklist before Today, following a reminders-first and records-afterward reading order.
- Paper view now keeps the same main-checklist plus progress-sidebar structure as Xingzhou view. Titles, time labels, reminders, and checkboxes are larger in both views, while printing still outputs only the paper checklist.

### Fixed

- Fixed the first Checklist write being falsely reported as an integrity failure when JSON property order changed after normalization.
- Fixed Paper view abruptly centering the checklist and removing the progress sidebar when switching from Xingzhou view.

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
