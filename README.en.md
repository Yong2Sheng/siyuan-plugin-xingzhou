# Xingzhou · Personal Action & Life System

Xingzhou is a self-contained SiYuan system for personal action and daily rhythm. Projects and tasks live in one top-level module; research-life balance, wellbeing, and recovery records live in another. Both use plugin-managed private data without requiring extra SiYuan databases or documents.

> Current version: `0.7.0` (execution slices, daily-task integration, autosave, private storage, and read-after-write verification)

[中文说明](README.md) · [中文更新日志](CHANGELOG.md) · [English Changelog](CHANGELOG.en.md)

## Highlights

- Separate top-level Projects & Tasks and Life Rhythm modules, each with its own second-level navigation.
- Daily profiles for research workdays, Saturday reset, Sunday half-day research, and holidays, with weekday defaults and per-date overrides.
- Daily forms follow a Morning / After lunch / Clock-out / After work / 21:00 timeline and save automatically. Sleep duration uses hour/minute selectors, weight supports kg/lb, and actual lights-off and wake values retain explicit cross-day dates. A bedtime plan can target the same evening or the next day, or use Free arrangement without recording a planned lights-off time.
- Training details appear only after training is marked complete. The after-work closure flow distinguishes Pending, Not needed, and Needed, then asks whether a next step exists before showing its text field. Not-needed durations remain not applicable rather than becoming zero.
- The 21:00 review first asks whether work continued after hours and whether there was an anomaly or observation. Explanatory fields appear only for Yes, so No no longer requires typing placeholders such as “none.”
- Holiday records treat work metrics as not applicable instead of failed or zero-valued.
- Transactions can be divided into a target number of execution slices with a per-slice estimate and independently scheduled on a calendar. Completion is shown as a percentage; missed and abandoned attempts remain in history while releasing a replacement slot.
- A deadline acts only as the latest schedulable date. Transactions without a deadline can still schedule and move slices from today onward.
- Week uses execution slices as dated work, while Life Rhythm automatically shows today's personal slices and can add a slice from an in-progress transaction with immediate synchronization back to Projects & Tasks.
- Complete hierarchy browsing for areas, top-level projects, subprojects, tasks, transactions, and ideas, with Today markers and rolled-up counts along relevant project paths. Siblings can be manually reordered with per-row Up/Down controls or the drag handle.
- Week remains compatible with legacy planned-date and per-day completion records. Transactions configured with execution slices now follow their explicit slice dates instead of being repeated mechanically across every day from start to deadline.
- Returning to Projects & Tasks restores the previous page, filters, hierarchy expansion, selected work item, and scroll position.
- Direct editing of lifecycle, hierarchy, dates, execution cost, and action details; Current Action Details and Next Action render basic SiYuan Markdown while being viewed, expand their editors to fit the full content, continue lists while being edited, and immediately normalize sibling numbering after typing, deletion, cutting, or pasting.
- Cross-project hard prerequisites and should-stay-ahead relationships, with cycle prevention.
- Optional links to SiYuan documents without requiring a document for every work item.
- Safe deletion that keeps descendants and clears references to the removed item.

## Storage and migration

Complete work items, sibling order, legacy per-date completion records, and execution slices live in the plugin-private `work-items.json`. Before every mutation Xingzhou rotates the previous version through three private backup files, saves the new store, then reads it back and verifies exact equality. An invalid primary store recovers from the newest valid backup; if none is valid, writes stop instead of silently overwriting data.

When upgrading from `0.4.x` with no internal store yet, Xingzhou reads the configured legacy Attribute View once, combines it with legacy plugin-private dependency data, and saves a migration snapshot. Normal operation no longer reads or modifies that Attribute View after migration.

Once the migrated work items have been verified in Xingzhou, deleting the legacy database or its containing document does not delete the internal work items. A work item may still retain a link to a SiYuan document; deleting that document only makes the link unavailable.

Life Rhythm uses a separate `daily-records.json`. It starts empty and never reads or migrates the old daily-data document. Its public read-only integration points are `getDailyRecordsSnapshot({ from?, to? })` and `getDailyRubrics()` for future weekly, monthly, or AI analysis.

## Development

```bash
pnpm install
pnpm test
pnpm check
pnpm build
```

The build creates `dist/` and an installable `package.zip`.

## Privacy

Xingzhou contains no remote service. Work items, the migration snapshot, and rotating backups use SiYuan's plugin-private data mechanism. The plugin accesses local SiYuan content only for one-time legacy migration or when opening a linked document, and it never creates or deletes documents automatically.

## License

[MIT](LICENSE)
