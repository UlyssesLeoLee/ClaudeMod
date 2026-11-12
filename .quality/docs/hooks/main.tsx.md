# Technical Design: `hooks/main.tsx`

Source: `hooks/main.tsx`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

The single hooks module of the `claude-mod` mod (listed in `hooks/hooks.json`). It joins the features into one mod:

- The mod's only unmatched `session.start` hook: records which code the session loaded (`noteBuild`), runs each feature's start (`startBranches`, `startDocLinks`, `startOverview`), then opens the branch pane.
- Registers each feature's hooks: `registerBranches(on)`, `registerDocLinks(on)`, `registerOverview(on)`.
- Draws the band above the prompt (`ui.render` `AbovePrompt`): one button per feature — 📋 任务概要, 📚 关联文档, 🌿 分支记录 (🚨 分支记录 · 近5天 AI×N while the branch feature reports recent AI commits). A survey above the prompt takes precedence (`hasSurvey` → `next(e)`).

A new feature is a folder under `hooks/` exporting `startX($)`, `registerX(on)` and `openX($)`; it joins the mod with one call in each of the three places above.

## Dependencies

- `./core/build` (`noteBuild`).
- `./branches/pane` (`startBranches`, `registerBranches`, `openBranchPane`, `branchAlarm`).
- `./doclinks/pane` (`startDocLinks`, `registerDocLinks`, `openDocPane`).
- `./overview/pane` (`startOverview`, `registerOverview`, `openOverview`).
- Engine: `session.start`, `ui.render` (`AbovePrompt`), `$.ui.resolve`.

## Public Contract

- Export `register: Register`.
- Session start never runs git, a model or a file scan; it resets per-session state, registers `/branch-status`, `/doc-links`, `/task-overview`, and opens the 分支变更 pane.
- The band reads one number (`branchAlarm`) per redraw; it never reads a snapshot or the store.

## Change Notes

- The mod is named `claude-mod`; its state contract and its store live under that name. Data stored under the former plugin name `branch-status` is not read.
- Pane ids (`branch-status`, `commit-detail`, `doc-links`, `task-overview`) and the three slash commands are unchanged.
