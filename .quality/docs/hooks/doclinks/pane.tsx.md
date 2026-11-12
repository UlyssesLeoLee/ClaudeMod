# Technical Design: `hooks/doclinks/pane.tsx`

Source: `hooks/doclinks/pane.tsx`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

The 关联文档 feature: the `doc-links` pane, `/doc-links`, and the update after a review.

- 🔗 智能关联: the task is read from the session record (`$.session.messages`). The scan is wide: `docs`, `doc`, `.quality/docs`, `.quality/test-design`, top-level folders named like documents, the project's extra folders, and up to 3 folders beside the project named like it or like documents (shown as 相邻文件夹（已自动一起扫描）with ➕ 固定加入). Every document file is a candidate; its kind is guessed from its path inside the folder walked; the model (haiku) files each link under req / basic / detail / ut / it / st / spec / plan / other; every named kind the scan found gets at least one link (`coverKinds`). Then each linked file's SHA256, mtime and size are recorded.
- The result starts folded: one row per kind with its count (`要件定义（2）`); a kind's documents show only after its ▶ is pressed. No document name is drawn while every kind is folded.
- Per document: ☑ pick, 📄 打开, 📂 文件夹, ✕ 移除; 🔄 检查状态 and ✔ 接受修改 for the whole list.
- 📝 按本任务改动更新 asks first, then submits the fixed update prompt as the person's words; after that turn the SHA256 of each document is checked, and documents that did not change get 📝 手动更新这些文档.
- After a review (`/code-review`, a review skill or agent, or review words in a prompt) followed by code edits, the end of that turn links and updates the documents automatically.
- Extra folders: `/doc-links add|remove|list` or ➕ 添加文档目录 (fills the prompt box with `/doc-links add `).
- Results are kept by project root (`saveForProject('docLinks', root, …)`) and found from any folder inside the project (`loadNearest`).

## Dependencies

- `./logic` (rules, prompts), `./review` (review rules), `../core/files` (`projectRoot`, `runPython`, `senseFiles`, `openInApp`, `revealInFolder`), `../core/store`, `../core/util`, `../core/build` (`buildFooter`).
- Engine: `$.session.messages`, `$.session.cwd`, `$.fs.list/read/exists`, `$.model.complete`, `$.prompt.submit`, `$.prompt.fill`, `$.store`, `$.ui.open`, `$.ui.toast`, hooks `prompt.submit`, `turn.start`, `tool.call`, `turn.complete`, `command.run`.

## Public Contract

- `startDocLinks($)`, `registerDocLinks(on)`, `openDocPane($)` (pane id `doc-links`, title 关联文档).
- State keys under `claude-mod`: `docResult`, `docBusy`, `docSkip`, `docConfirm`, `docSentAt`, `docKindOpen`, `docFolders`, `syncReview`, `syncEdited`, `syncPhase`, `syncBefore`, `syncUnchanged`, `syncNote`.
- Store keys: `docLinks:<project root>`, `docFolders:<project root>` (and `docFolders:<session folder>` when it differs).
- Hooks on `prompt.submit`, `turn.start`, `tool.call` never block or alter the event: their own failures are swallowed.

## Change Notes

- The feature lives in `hooks/doclinks/`. Links are kept under the project root and found from subfolders, so a session whose shell moved into `docs/…` shows the project's links.
