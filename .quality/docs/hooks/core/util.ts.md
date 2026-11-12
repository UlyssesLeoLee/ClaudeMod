# Technical Design: `hooks/core/util.ts`

Source: `hooks/core/util.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

Pure helpers every feature shares: path comparison, store keys, absolute paths and times.

## Dependencies

None (no engine calls, no imports from features).

## Public Contract

- `normPath(p)` — forward slashes, lower case, no trailing slash.
- `samePath(a, b)` — `normPath(a) === normPath(b)`.
- `projectKey(kind, path)` — `${kind}:${normPath(path)}`: the store key of one project's data of one kind.
- `ancestors(path)` — the path, then each folder above it up to the drive or filesystem root, in `normPath` form: `D:/A/b/c` → `d:/a/b/c`, `d:/a/b`, `d:/a`, `d:/`.
- `isAbsolutePath(p)` — drive letter, leading `/` or UNC `\\`.
- `fullPath(root, p)` — `p` when absolute, else `${root}/${p}`.
- `fullTime(ms)` — local `YYYY-MM-DD HH:mm`.
- `relTime(ts, now)` — 刚刚 / N 分钟前 / N 小时前 / N 天前.

## Change Notes

- These helpers are the shared core of the mod; feature folders import them from here and never from one another.
