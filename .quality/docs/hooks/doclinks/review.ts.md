# Technical Design: `hooks/doclinks/review.ts`

Source: `hooks/doclinks/review.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

Pure rules that decide when a review's code changes call for a document update:

- `isReviewText(text)` — a prompt, command name, skill or agent description that names a review: `code-review` / `code_review` / `code review`, the word `review`, 审查, 审核, 评审, レビュー, 審査 (case-insensitive).
- `editedPath(tool, input)` — `file_path` (or `notebook_path`) of an `Edit`, `Write`, `MultiEdit` or `NotebookEdit` call, else `''`.
- `isCodePath(path)` — not empty, not under a `doc/`, `docs/` or `.quality/` folder, and not a document file (`.md .markdown .txt .xlsx .xlsm .xls .docx .doc .pdf .csv`).
- `unchangedDocs(before, after)` — paths of `before` (SHA256 by path before the update turn) that the update left as they were: same SHA256 after, gone, or unreadable after. A path with no SHA256 before counts as changed only when one can be read after.

## Dependencies

Types from `../../types`. No engine calls.

## Public Contract

Pure functions; unknown tools and inputs give `''` / `false` / `[]`.

## Change Notes

- Lives in `hooks/doclinks/` with the feature it serves.
