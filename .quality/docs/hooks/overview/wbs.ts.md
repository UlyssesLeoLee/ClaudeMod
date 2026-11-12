# Technical Design: `hooks/overview/wbs.ts`

Source: `hooks/overview/wbs.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

Pure rules of the overview feature:

- The WBS file and its table: `WBS_PATH` (`docs/WBS.md`), `WBS_COLUMNS` (编号, 任务, 负责人, 预定开始, 预定结束, 实际结束, 工数(人日), 进度%, 状态), `WBS_STATUSES` (未开始, 进行中, 已完成, 已取消), `normHeader`, `splitRow`, `normDate`, `parseWbs(text)` (CRLF, BOM, loose pipes, full-width headers, `40%`, slash dates accepted).
- Counting: `completion(tasks)` over leaves (1.10 is no child of 1.1), weighted by 工数 only when every counted leaf has one; `unfinished(tasks, today)` overdue first; `isOverdue`; `localDate`.
- Summary: `SUMMARY_LIMIT` 140 (characters, not UTF-16 units), `capSummary`, `fallbackSummary`.
- Model check: `CHECK_SYSTEM`, `buildCheckPrompt(today, tasks, state)`, `parseCheck(text, tasks)` (mismatches naming a WBS task of a known kind only), `MISMATCH_TEXT`.
- Storage: `restoredOverview(value)`.
- Creation: `CREATE_HEADER`, `buildCreatePrompt()` (fixed template naming the columns and an example row).

## Dependencies

Types from `../../types`. No engine calls.

## Public Contract

Pure functions; `parseWbs` never throws and reports problems in `warnings`; `hasTable` false when no header with 任务 and 进度% or 状态 exists.

## Change Notes

- Lives in `hooks/overview/` with the feature it serves.
