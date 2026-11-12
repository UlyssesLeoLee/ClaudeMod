# Technical Design: `hooks/doclinks/logic.ts`

Source: `hooks/doclinks/logic.ts`

Source-SHA256: `0827e6f5b0cc5631483f164eeded6188aa054eb135520048d7fb538e4d19e0e8`

## Responsibility

Pure rules of the doc feature:

- Where documents are: `DOC_ROOTS`, `isDocFolder`, `isDocFile` (`.xlsx .xlsm .xls .md .markdown .txt`, not `~$` lock files), `nameWords`, `isRelatedFolder(projectName, name)`, `parentOf`, `folderOf`, limits `MAX_DEPTH` 6, `MAX_FILES` 2000, `MAX_CANDIDATES` 300.
- Which kind a path is: `classify(relPath)` by ordered rules — UT, IT, ST (テスト / 試験 / 测试 / 试验 and English, and whole-token UT/IT/ST), then req, basic, detail, then a test document naming no level as UT, then SPEC, then PLAN. `KINDS` with labels 要件定义, 基本设计, 详细设计, UT/IT/ST 测试设计, SPEC 规格说明, PLAN 计划, 其他相关文档.
- The task: `personText`, `taskFrom`, `rankingTask` (engine tags stripped, slash commands by their arguments, the mod's own update prompt never read back).
- Ranking: `keywords`, `keywordScore`, `byRelevance`, `buildRankPrompt` (recall first, up to `LINKS_PER_KIND` 5 per kind), `parseRanking` (ids from the list only; the model's kind wins), `coverKinds` (one link per named kind found, reason `按类型补充：AI 未判定与本任务直接相关`), `fallbackRanking`.
- Status: `docStatus`, `STATUS_TEXT`, `withSensed`, `accepted`.
- Storage: `DOC_KIND = 'docLinks'`, `restored(value)`.
- The update prompt: `UPDATE_HEADER`, `buildUpdatePrompt(links)` (template and paths only).
- `.nema`: `DOC_EXTS` includes `.nema`, so `.nema` files are documents like any other and are classified by their names; `isNemaPath(path)`. `buildUpdatePrompt` adds, only when a linked document is `.nema`, the fixed rule: edit only the domains the task concerns, raise the revision in the header of each domain edited, keep every other domain and every domain ID as it is, and follow the `.nema` grammar.

## Dependencies

- `../core/util` (`projectKey`, `fullPath`, `isAbsolutePath`), types from `../../types`.

## Public Contract

All functions are pure. `restored` accepts only a value of the current `DocResult` shape. `buildUpdatePrompt` strips control characters from paths.
- `isNemaPath(path)` — a path ending in `.nema`, any case.

## Change Notes

- `fullPath` and `isAbsolutePath` come from `hooks/core/util.ts` and are re-exported here for the doc feature.
- Stored links are read through `hooks/core/store.ts` under the project root; `storeKey(path)` is `projectKey('docLinks', path)`.
- `.nema` documents are scanned, linked and updated with their domain rule.

