# Technical Design: `hooks/doclinks/logic.ts`

Source: `hooks/doclinks/logic.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

Pure rules of the doc feature:

- Where documents are: `DOC_ROOTS`, `isDocFolder`, `isDocFile` (`.xlsx .xlsm .xls .md .markdown .txt`, not `~$` lock files), `nameWords`, `isRelatedFolder(projectName, name)`, `parentOf`, `folderOf`, limits `MAX_DEPTH` 6, `MAX_FILES` 2000, `MAX_CANDIDATES` 300.
- Which kind a path is: `classify(relPath)` by ordered rules — UT, IT, ST (テスト / 試験 / 测试 / 试验 and English, and whole-token UT/IT/ST), then req, basic, detail, then a test document naming no level as UT, then SPEC, then PLAN. `KINDS` with labels 要件定义, 基本设计, 详细设计, UT/IT/ST 测试设计, SPEC 规格说明, PLAN 计划, 其他相关文档.
- The task: `personText`, `taskFrom`, `rankingTask` (engine tags stripped, slash commands by their arguments, the mod's own update prompt never read back).
- Ranking: `keywords`, `keywordScore`, `byRelevance`, `buildRankPrompt` (recall first, up to `LINKS_PER_KIND` 5 per kind), `parseRanking` (ids from the list only; the model's kind wins), `coverKinds` (one link per named kind found, reason `按类型补充：AI 未判定与本任务直接相关`), `fallbackRanking`.
- Status: `docStatus`, `STATUS_TEXT`, `withSensed`, `accepted`.
- Storage: `DOC_KIND = 'docLinks'`, `restored(value)`.
- The update prompt: `UPDATE_HEADER`, `buildUpdatePrompt(links)` (template and paths only).

## Dependencies

- `../core/util` (`projectKey`, `fullPath`, `isAbsolutePath`), types from `../../types`.

## Public Contract

All functions are pure. `restored` accepts only a value of the current `DocResult` shape. `buildUpdatePrompt` strips control characters from paths.

## Change Notes

- `fullPath` and `isAbsolutePath` come from `hooks/core/util.ts` and are re-exported here for the doc feature.
- Stored links are read through `hooks/core/store.ts` under the project root; `storeKey(path)` is `projectKey('docLinks', path)`.
