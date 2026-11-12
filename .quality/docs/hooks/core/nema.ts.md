# Technical Design: `hooks/core/nema.ts`

Source: `hooks/core/nema.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

Reads `.nema` files, the person's multi-agent document format, and tells what each domain holds and how domains changed. Pure, no engine calls.

`.nema` grammar, as the strict reference parser of nema-thread states it:

- A domain starts with a header line ` \<tag><ID> <REV>`: exactly one leading ASCII space, a backslash, an optional tag (`?` a 5W1H domain, `>` a node–edge graph, none a table), a positive ID without leading zero, one space, a positive revision. IDs are unique in a file. Each agent edits its own domain and raises that domain's revision.
- Body lines belong to the latest domain; a body line before any domain is an error; empty lines are skipped.
- Fields are split by single ASCII spaces. `~` alone is null, `\_` alone is missing, `\e` alone is the empty string; escapes `\ ` `\\` `\?` `\>` `\<` `\=` `\~` `\^` `\#` `\_` `\%` `\n` `\r` `\t` `\e`. Two spaces in a row, a trailing space, a trailing backslash or an unknown escape are errors.
- Table: optional `\# name…` (unique, non-empty names, before any record) and `\%N` (width, once, before any record); otherwise the first record sets the width (`column1…`). A record wider than the table is an error; shorter ones are padded with missing.
- 5W1H: records of at most six fields, padded with missing.
- Graph: a record is a node `ID name…` or an edge `A>e>B`, `A<e<B`, `A=e=B` with a name; IDs match `[A-Za-z][A-Za-z0-9_.:-]*`; node and edge IDs are unique and never overlap; an edge's ends must be nodes.
- A line with N leading spaces appends one text field to column N of the previous record (graph: column N+1); appending to null or missing is an error (graph: a new column may be filled).
- Raw Tab, fullwidth space (U+3000) and bare CR are errors. CRLF line endings are read as LF, since Git on Windows checks files out with CRLF.

Functions:

- `parseNema(text)` — `{ domains, error, errorLine }`; on the first error, `error` names it (`第 N 行：…`) and `domains` holds what was read before it.
- `domainStates(parsed)` — per domain `{ id, mode, revision, fingerprint }`; `fingerprint` is the FNV-1a 32-bit hex of the domain's body lines joined by LF.
- `domainChanges(base, now)` — per domain ID: `added`, `removed`, or `changed` (fingerprint or revision differs), with the revision before and after and `isBumped` (revision raised).
- `changeText(change)` — `\3 修订 2→3 已修改`, `\3 内容已改，修订号未增加（仍为 2）`, `\5 新增（修订 1）`, `\4 已删除`; 5W1H and graph domains show their tag (`\?2`, `\>3`).
- `nemaSummary(parsed, limit)` — one line per domain for the ranking model: tag, ID, revision, kind, column names, record count, first record; capped at `limit` characters.
- `nemaTable(parsed, column)` — the first table domain whose columns include `column`, as `{ columns, rows }` of strings (null and missing as `''`), or `undefined`.

## Dependencies

None: no engine calls and no imports from the features. Callers read the file (`$.fs.read`, or `git show` for a commit's version) and pass its text in. Used by `hooks/doclinks/pane.tsx`, `hooks/overview/wbs.ts` and `hooks/branches/pane.tsx`.

## Public Contract

- Types `NemaMode`, `NemaDomain`, `NemaParse`, `NemaDomainState`, `NemaChange` (state types declared in `types/index.d.ts`).
- `parseNema` never throws; a file is valid exactly when `error === ''`.
- A line that starts like a header (` \1`, ` \?2`, ` \>3`) but does not match it exactly — extra text after the revision, a missing revision — is a malformed header, never a body line.
- `domainChanges` lists domains in ID order; an unchanged domain is not listed.

## Change Notes

- `.nema` files are read by the doc, overview and branch features through this module.
