# Technical Design: `hooks/overview/pane.tsx`

Source: `hooks/overview/pane.tsx`

Source-SHA256: `1a4c693c2a74c77151248fbd6e31f24f85cbce912b20cc5ab6932af05a09cce9`

## Responsibility

The 任务概要 feature: the `task-overview` pane and `/task-overview`.

- 📊 生成概要 reads `docs/WBS.md` (any case), counts completion (by 工数 when every counted task has one, else by count; 已取消 left out), lists unfinished tasks with overdue ones first (at most 30 before …另有), and asks the model (haiku) to check the WBS against the repository's branch, latest 60 commits and uncommitted changes. The model's summary is cut to 140 characters; mismatches naming a WBS task of a known kind are shown. Without the model the summary comes from the numbers and says so.
- Without a WBS: 📝 新建 WBS asks first, looks again, and only then submits the fixed create prompt as the person's words.
- Nothing is read, run or asked before 生成概要 is pressed.
- The overview is kept by project root (`saveForProject('overview', root, …)`) and found from any folder inside the project (`loadNearest`).

## Dependencies

- `./wbs` (parsing, counting, prompts), `../core/files` (`projectRoot`, `runGit`), `../core/store`, `../core/util` (`fullTime`, `relTime`), `../core/build` (`buildFooter`).
- Engine: `$.fs.list`, `$.fs.read`, `$.process.run` (git, read-only), `$.model.complete`, `$.prompt.submit`, `$.store`, `$.ui.open`, `$.ui.toast`, `$.command.register`, `$.clock.now`.

## Public Contract

- `startOverview($)`, `registerOverview(on)`, `openOverview($)` (pane id `task-overview`, title 任务概要).
- State keys under `dev-cockpit`: `ovResult`, `ovBusy`, `ovConfirm`, `ovNote`.
- Store key `overview:<project root>`.
- A failed run keeps the last good overview and shows why.

## Change Notes

- The feature lives in `hooks/overview/`. Overviews are kept under the project root and found from subfolders.
