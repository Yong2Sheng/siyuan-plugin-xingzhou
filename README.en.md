# Xingzhou · Personal Projects & Tasks

Xingzhou is a SiYuan plugin for managing personal projects with low friction. A native Attribute View remains the single source of truth; the plugin adds a focused interface for browsing and progressively expanding the work that currently needs attention.

> Current version: `0.1.0` (first read-only test release)

[中文说明](README.md) · [中文更新日志](CHANGELOG.md) · [English Changelog](CHANGELOG.en.md)

## Goals

- Reduce the decision cost of choosing what to do in limited personal time.
- Capture long-term areas, projects, tasks, transactions, and ideas in one database.
- Keep complete project maps in project documents and only managed work items in the database.
- Store only the direct parent relation and reconstruct the full hierarchy from it.
- Keep simple one-off transactions in the database without forcing a document.
- Follow SiYuan themes and dark mode.
- Avoid turning personal project management into performance pressure.

## Included in v0.1

- Reads the “全部工作项” view from a configured SiYuan Attribute View.
- Long-term area and independent work-item navigation.
- Active-path expansion and collapse-all controls.
- All, active project, someday/maybe, and closed filters.
- Detail panel for hierarchy, status, dates, duration, energy, current action details, and next action.
- Opens linked SiYuan documents and the native database block.
- Warns about self-parenting, multiple parents, missing parents, cycles, and top-project mismatches.
- Loading, empty, error, and missing-optional-field states.
- SiYuan theme token and dark-mode support.
- Configurable Attribute View ID and database block ID.

This release is intentionally read-only. It never adds fields, changes work items, or auto-repairs relations. Week planning, inbox, and review pages are visible placeholders for later iterations.

## Expected fields

The primary field is `工作项`. Xingzhou also recognizes `工作项类型`, `状态`, `上层工作项`, `所属顶层项目`, `本次行动细则`, `下一步行动`, `计划日期`, `截止日期`, `预计时长（分钟）`, and `所需精力`. Optional fields can be absent without breaking the interface.

## Development

```bash
pnpm install
pnpm test
pnpm check
pnpm build
```

The production build creates `dist/` and an installable `package.zip`.

## Data and privacy

Xingzhou has no remote service. v0.1 only reads the configured Attribute View through SiYuan’s local API, stores only binding IDs in plugin-private data, and is disabled in Publish mode.

## License

[MIT](LICENSE)
