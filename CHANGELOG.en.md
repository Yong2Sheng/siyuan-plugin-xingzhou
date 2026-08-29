# Changelog

This file records notable changes to Xingzhou. The default changelog is Chinese; see [CHANGELOG.md](CHANGELOG.md).

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

- This is a read-only test release and does not change fields or cells.
- Week, inbox, and review pages are placeholders.
- A missing “本次行动细则” field is reported but never created automatically.
