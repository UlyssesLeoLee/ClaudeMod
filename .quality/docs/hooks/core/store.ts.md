# Technical Design: `hooks/core/store.ts`

Source: `hooks/core/store.ts`

Source-SHA256: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Responsibility

Keeps a feature's per-project result under the project's root and finds it again from any folder inside the project, without running git:

- `saveForProject($, kind, root, value)` — `$.store.set(projectKey(kind, root), value)`; `root` is the repository's top level (or the session folder outside a repository).
- `loadNearest($, kind, restore, at)` — reads `projectKey(kind, p)` for the session folder and every folder above it (`ancestors`), keeps the values `restore` accepts, and returns the one with the latest `at(value)`; `undefined` when none.

A session whose shell moved into a subfolder (`D:/OA-Partner/docs/architecture`) therefore finds what was saved for `D:/OA-Partner`.

## Dependencies

- `./util` (`projectKey`, `ancestors`).
- Engine: `$.session.cwd`, `$.store.get`, `$.store.set`.

## Public Contract

- `saveForProject<T>($, kind: string, root: string, value: T): Promise<void>`.
- `loadNearest<T>($, kind: string, restore: (v: unknown) => T | undefined, at: (v: T) => number): Promise<T | undefined>`.
- A store read that throws counts as no value for that folder.

## Change Notes

- Doc links (`docLinks`) and task overviews (`overview`) are kept by project root and read through `loadNearest`.
