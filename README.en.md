# Xingzhou · Personal Projects & Tasks

Xingzhou is a self-contained SiYuan plugin for personal projects and tasks. Areas, projects, tasks, transactions, ideas, hierarchy, and cross-project dependencies are stored in plugin-managed private data; no extra SiYuan database or document is required as the data store.

> Current version: `0.5.0` (complete internal storage, one-time legacy migration, rotating backups, and read-after-write verification)

[中文说明](README.md) · [中文更新日志](CHANGELOG.md) · [English Changelog](CHANGELOG.en.md)

## Highlights

- Complete hierarchy browsing for areas, top-level projects, subprojects, tasks, transactions, and ideas, with Today markers and rolled-up counts along relevant project paths.
- Week projects multi-day work across the full planned-start-to-deadline interval with start, ongoing, deadline, and cross-week markers; it also supports calendar scheduling, while Inbox provides low-friction capture and Review provides a five-step flow.
- Direct editing of lifecycle, hierarchy, dates, execution cost, and action details; Current Action Details and Next Action render basic SiYuan Markdown while being viewed, expand their editors to fit the full content, continue lists while being edited, and immediately normalize sibling numbering after typing, deletion, cutting, or pasting.
- Cross-project hard prerequisites and should-stay-ahead relationships, with cycle prevention.
- Optional links to SiYuan documents without requiring a document for every work item.
- Safe deletion that keeps descendants and clears references to the removed item.

## Storage and migration

The complete store lives in the plugin-private `work-items.json`. Before every mutation Xingzhou rotates the previous version through three private backup files, saves the new store, then reads it back and verifies exact equality. An invalid primary store recovers from the newest valid backup; if none is valid, writes stop instead of silently overwriting data.

When upgrading from `0.4.x` with no internal store yet, Xingzhou reads the configured legacy Attribute View once, combines it with legacy plugin-private dependency data, and saves a migration snapshot. Normal operation no longer reads or modifies that Attribute View after migration.

Once the migrated work items have been verified in Xingzhou, deleting the legacy database or its containing document does not delete the internal work items. A work item may still retain a link to a SiYuan document; deleting that document only makes the link unavailable.

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
