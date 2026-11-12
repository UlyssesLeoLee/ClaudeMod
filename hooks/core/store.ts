// A feature's per-project result, kept under the project's root and found again from
// any folder inside the project, without running git.
import type { EngineInterface } from 'claude-code'

import { ancestors, projectKey } from './util'

/** Keeps `value` for the project at `root` (the repository's top level, or the session folder). */
export async function saveForProject<T>($: EngineInterface, kind: string, root: string, value: T): Promise<void> {
  await $.store.set(projectKey(kind, root), value)
}

/**
 * The latest value of `kind` kept for the session folder or any folder above it:
 * a session whose shell moved into `docs/…` still finds what its project root keeps.
 */
export async function loadNearest<T>(
  $: EngineInterface,
  kind: string,
  restore: (value: unknown) => T | undefined,
  at: (value: T) => number,
): Promise<T | undefined> {
  let best: T | undefined
  for (const folder of ancestors(await $.session.cwd())) {
    const value = restore(await $.store.get(projectKey(kind, folder)).catch(() => undefined))
    if (value !== undefined && (best === undefined || at(value) > at(best))) best = value
  }
  return best
}
