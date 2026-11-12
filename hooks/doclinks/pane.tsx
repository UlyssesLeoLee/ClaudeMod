import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { DocLink, DocResult } from '../../types'
import {
  DOC_KIND,
  DOC_ROOTS,
  KINDS,
  UPDATE_HEADER,
  MAX_CANDIDATES,
  MAX_DEPTH,
  MAX_FILES,
  RANK_SYSTEM,
  SNIPPETS_PER_KIND,
  SNIPPETS_TOTAL,
  STATUS_TEXT,
  accepted,
  buildRankPrompt,
  buildUpdatePrompt,
  byRelevance,
  coverKinds,
  classify,
  docStatus,
  fallbackRanking,
  folderOf,
  fullPath,
  isAbsolutePath,
  isDocFile,
  isDocFolder,
  isRelatedFolder,
  parentOf,
  rankingTask,
  keywordScore,
  keywords,
  parseRanking,
  restored,
  taskFrom,
  withSensed,
} from './logic'
import type { Candidate, DocStatus, SessionLine, Task } from './logic'
import { editedPath, isCodePath, isReviewText, unchangedDocs } from './review'
import { buildFooter } from '../core/build'
import { openInApp, projectRoot, revealInFolder, runPython, senseFiles } from '../core/files'
import { loadNearest, saveForProject } from '../core/store'
import { fullTime, normPath, projectKey, relTime, samePath } from '../core/util'

export const DOC_PANE = 'doc-links'
const DOC_TITLE = '关联文档'
const RANK_MODEL = 'haiku'
const NO_PYTHON_HASH = '没能用 Python 计算 SHA256 和修改时间，文档状态暂时无法判断。'

const EMPTY: DocResult = { at: 0, checkedAt: 0, root: '', task: '', links: [], found: 0, warnings: [], error: '' }

// This session's copy; the store keeps each project's across sessions.
const result = atom({ plugin: 'dev-cockpit', key: 'docResult' } as const, EMPTY, {
  shape: 'docResult-3',
})
// What the pane is doing: '', 'link' or 'check'.
const busy = atom({ plugin: 'dev-cockpit', key: 'docBusy' } as const, '', { shape: 'docBusy-2' })
const skip = atom(
  { plugin: 'dev-cockpit', key: 'docSkip' } as const,
  {} as Record<string, boolean>,
  { shape: 'docSkip-1' },
)
const confirm = atom({ plugin: 'dev-cockpit', key: 'docConfirm' } as const, false, {
  shape: 'docConfirm-1',
})
const sentAt = atom({ plugin: 'dev-cockpit', key: 'docSentAt' } as const, 0, {
  shape: 'docSentAt-1',
})
const syncReview = atom({ plugin: 'dev-cockpit', key: 'syncReview' } as const, false, { shape: 'syncReview-1' })
const syncEdited = atom({ plugin: 'dev-cockpit', key: 'syncEdited' } as const, [] as string[], {
  shape: 'syncEdited-1',
})
const syncPhase = atom({ plugin: 'dev-cockpit', key: 'syncPhase' } as const, '', { shape: 'syncPhase-1' })
const syncBefore = atom(
  { plugin: 'dev-cockpit', key: 'syncBefore' } as const,
  {} as Record<string, string>,
  { shape: 'syncBefore-1' },
)
const syncUnchanged = atom({ plugin: 'dev-cockpit', key: 'syncUnchanged' } as const, [] as string[], {
  shape: 'syncUnchanged-1',
})
const syncNote = atom({ plugin: 'dev-cockpit', key: 'syncNote' } as const, '', { shape: 'syncNote-1' })
// The extra folders once changed in this session (null: read them from the store).
// The kinds the person opened; every kind starts folded.
const kindOpen = atom(
  { plugin: 'dev-cockpit', key: 'docKindOpen' } as const,
  {} as Record<string, boolean>,
  { shape: 'docKindOpen-1' },
)
const folderList = atom(
  { plugin: 'dev-cockpit', key: 'docFolders' } as const,
  null as string[] | null,
  { shape: 'docFolders-1' },
)

// One scan or check at a time: set before the first await.
let working = false

export function openDocPane($: EngineInterface) {
  return $.ui.open({ id: DOC_PANE, title: DOC_TITLE })
}

/**
 * The links of this project: this session's, else the latest kept for the session
 * folder or a folder above it (the project's root), from an earlier session.
 */
async function loadResult($: EngineInterface): Promise<DocResult> {
  const inSession = await read($, result)
  if (inSession.at !== 0 || inSession.error !== '') return inSession
  return (await loadNearest($, DOC_KIND, restored, r => r.at)) ?? EMPTY
}

// Keeps a good result in this session and, under the project's root, for later ones;
// an error is never stored.
async function saveResult($: EngineInterface, next: DocResult) {
  const kept = { ...next, error: '' }
  await update($, result, () => kept)
  await saveForProject($, DOC_KIND, kept.root || (await $.session.cwd()), kept)
}

/** The task as this session's record states it, history before this mod loaded included. */
async function readTask($: EngineInterface): Promise<Task | undefined> {
  const messages = await $.session.messages().catch(() => undefined)
  return Array.isArray(messages) ? taskFrom(messages as readonly SessionLine[]) : undefined
}

async function busyWith($: EngineInterface, what: string, job: () => Promise<void>) {
  if (working) return
  working = true
  await update($, busy, () => what)
  try {
    await job()
  } finally {
    working = false
    await update($, busy, () => '')
  }
}

// `path` is what the pane keeps (project-relative, or absolute in an extra folder);
// `rel` is the path inside the folder walked, which alone is classified.
type Found = { path: string; rel: string; mtimeMs: number }

async function walk($: EngineInterface, base: string, rel: string, depth: number, out: Found[], isExtra = false) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
  const entries = await $.fs.list(rel ? `${base}/${rel}` : base).catch(() => [])
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    if (entry.isLink) continue
    const inner = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.kind === 'dir') {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
        await walk($, base, inner, depth + 1, out, isExtra)
      }
    } else if (entry.kind === 'file' && isDocFile(entry.name)) {
      out.push({ path: isExtra ? `${base}/${inner}` : inner, rel: inner, mtimeMs: entry.mtimeMs })
    }
  }
}

async function storedFolders($: EngineInterface, place: string): Promise<string[]> {
  const stored = await $.store.get(projectKey('docFolders', place))
  return Array.isArray(stored) ? stored.filter((f): f is string => typeof f === 'string') : []
}

/**
 * The project's extra document folders, kept across sessions under the project's root,
 * so a session opened in any of its subfolders finds them. `root` is the repository's
 * top level once known; until then the session's folder stands in.
 */
async function readFolders($: EngineInterface, root?: string): Promise<string[]> {
  const cwd = await $.session.cwd()
  const both = [...(root ? await storedFolders($, root) : []), ...(await storedFolders($, cwd))]
  return both.filter((f, i) => both.findIndex(g => samePath(g, f)) === i)
}

async function writeFolders($: EngineInterface, root: string, folders: string[]) {
  await $.store.set(projectKey('docFolders', root), folders)
  const cwd = await $.session.cwd()
  if (!samePath(cwd, root)) await $.store.set(projectKey('docFolders', cwd), folders)
  await update($, folderList, () => folders)
}

/** The folders as the pane draws them: this session's copy, else the store's. */
async function shownFolders($: EngineInterface): Promise<string[]> {
  return (await read($, folderList)) ?? (await readFolders($))
}

/**
 * Folders beside the project that may hold its documents, not yet added: named like the
 * project or like documents, and holding document files (in a `docs` inside, if it has one).
 */
async function nearbyDocFolders($: EngineInterface, root: string, added: readonly string[]): Promise<string[]> {
  const projectName = root.replace(/\/+$/, '').split('/').pop() ?? ''
  const parent = parentOf(root)
  if (samePath(parent, root)) return []
  const found: string[] = []
  for (const entry of await $.fs.list(parent).catch(() => [])) {
    if (found.length >= 3) break
    if (entry.kind !== 'dir' || entry.isLink || !isRelatedFolder(projectName, entry.name)) continue
    const folder = `${parent.replace(/\/$/, '')}/${entry.name}`
    const inner = await $.fs.list(folder).catch(() => [])
    const hasDocs = inner.find(e => e.kind === 'dir' && /^docs?$/i.test(e.name))
    const target = hasDocs ? `${folder}/${hasDocs.name}` : folder
    const holdsDocs = hasDocs !== undefined || inner.some(e => e.kind === 'file' && isDocFile(e.name))
    if (holdsDocs && !added.some(a => samePath(a, target))) found.push(target)
  }
  return found
}

// `/doc-links add <路径>`: an absolute folder that exists and isn't inside the project already.
async function addFolder($: EngineInterface, raw: string): Promise<string> {
  const folder = folderOf(raw)
  if (!isAbsolutePath(folder)) return `请给出完整路径，例如 /doc-links add D:\\项目文档\\docs（收到的是「${raw.trim()}」）。`
  const listed = await $.fs.list(folder).catch(() => undefined)
  if (listed === undefined) return `找不到文件夹 ${folder}，没有加入。`
  const root = await projectRoot($)
  if (samePath(folder, root) || normPath(folder).startsWith(`${normPath(root)}/`)) {
    return `${folder} 在当前项目里面，本来就会扫描，不用加入。`
  }
  const folders = await readFolders($, root)
  if (folders.some(f => samePath(f, folder))) return `${folder} 已经在额外文档目录里。`
  await writeFolders($, root, [...folders, folder])
  // Once added, it is no longer suggested.
  const r = await loadResult($)
  if (r.suggestions?.some(s => samePath(s, folder))) {
    await update($, result, () => ({ ...r, suggestions: r.suggestions?.filter(s => !samePath(s, folder)) }))
  }
  return `已加入额外文档目录：${folder}。下次「智能关联」会一起扫描。`
}

async function removeFolder($: EngineInterface, raw: string): Promise<string> {
  const folder = folderOf(raw)
  const root = await projectRoot($)
  const folders = await readFolders($, root)
  const left = folders.filter(f => !samePath(f, folder))
  if (left.length === folders.length) return `额外文档目录里没有 ${folder}。`
  await writeFolders($, root, left)
  return `已移除额外文档目录：${folder}。`
}

async function listFolders($: EngineInterface): Promise<string> {
  const folders = await readFolders($, await projectRoot($))
  return folders.length === 0
    ? '还没有额外文档目录。用 /doc-links add <路径> 加入，例如另一个文件夹里的 docs。'
    : `额外文档目录：\n${folders.map(f => `- ${f}`).join('\n')}`
}


// Sheet names and leading text of each workbook, through the mod's own script.
async function readBooks($: EngineInterface, root: string, paths: string[]) {
  const texts = new Map<string, string>()
  if (paths.length === 0) return { texts, warning: '' }
  const books = (await runPython($, root, 'xlsx_text.py', paths.map(p => fullPath(root, p)))) as
    | Record<string, { sheets?: string[]; text?: string }>
    | undefined
  if (books === undefined) {
    return { texts, warning: '没能用 Python 读取 Excel 内容，Excel 文档只按文件名判断。' }
  }
  for (const p of paths) {
    const book = books[fullPath(root, p)]
    if (book?.text !== undefined) texts.set(p, `工作表: ${(book.sheets ?? []).join('、')} | ${book.text}`)
  }
  return { texts, warning: '' }
}

// 智能关联: scans, reads a few, asks the model (keywords if it fails), then records each file's state.
function link($: EngineInterface) {
  return busyWith($, 'link', async () => {
    await update($, confirm, () => false)
    const before = await loadResult($)
    const next = await gather($).catch(
      async (err): Promise<DocResult> => ({ ...EMPTY, at: await $.clock.now(), error: String(err) }),
    )
    if (next.error !== '') {
      // A run that failed says why, here only: the links made before stay, stored and shown.
      await update($, result, () => ({ ...before, error: next.error, warnings: next.warnings }))
      return
    }
    await saveResult($, next)
    await update($, skip, () => ({}))
    // A fresh result starts folded: each kind shows its count until opened.
    await update($, kindOpen, () => ({}))
  })
}

async function gather($: EngineInterface): Promise<DocResult> {
  const at = await $.clock.now()
  const found = await readTask($)
  if (found === undefined) return { ...EMPTY, at, error: '读不到本会话的记录。' }
  if (found.asked.length === 0) {
    return { ...EMPTY, at, error: '本会话记录里还没有你的提问。先在对话里描述任务，再点「智能关联」。' }
  }
  const task = rankingTask(found)
  const asked = found.asked[found.asked.length - 1] ?? ''
  const root = await projectRoot($)
  const files: Found[] = []
  // The usual doc folders, then any top-level folder whose name looks like documents.
  const top = await $.fs.list(root).catch(() => [])
  const extra = top.filter(e => e.kind === 'dir' && !e.isLink && isDocFolder(e.name)).map(e => e.name)
  for (const dir of [...new Set([...DOC_ROOTS, ...extra])]) {
    if (await $.fs.exists(`${root}/${dir}`).catch(() => false)) await walk($, root, dir, 1, files)
  }
  // Then the project's extra folders: the same project's documents kept in another folder.
  const outside = await readFolders($, root)
  await update($, folderList, () => outside)
  const suggestions = await nearbyDocFolders($, root, outside)
  const warnings: string[] = []
  for (const folder of outside) {
    if (await $.fs.exists(folder).catch(() => false)) await walk($, folder, '', 1, files, true)
    else warnings.push(`额外文档目录 ${folder} 不存在了，跳过。`)
  }
  // The first pass is wide: folders beside the project that look like its documents are
  // scanned too, before anyone adds them; ➕ 固定加入 keeps one for good.
  for (const folder of suggestions) await walk($, folder, '', 1, files, true)
  const words = keywords(task)
  // First pass, wide: every document file is a candidate; its name only hints at its kind,
  // read inside the folder walked so an outside folder's own name never decides it.
  const candidates: Candidate[] = files
    .map(f => ({
      id: 0,
      path: f.path,
      kind: classify(f.rel) ?? ('other' as const),
      mtimeMs: f.mtimeMs,
      snippet: '',
      score: keywordScore(words, f.path),
    }))
    .sort(byRelevance)
    .slice(0, MAX_CANDIDATES)
    .map((c, i) => ({ ...c, id: i + 1 }))
  if (files.length >= MAX_FILES) warnings.push(`文档太多，只扫描了前 ${MAX_FILES} 个文件。`)
  if (candidates.length === 0) {
    return {
      ...EMPTY,
      at,
      root,
      warnings,
      error: `在 ${DOC_ROOTS.join('、')} 和名字像文档的文件夹里，没有找到文档文件（.xlsx、.md、.txt 等）。`,
    }
  }

  // Content for the best candidates overall and the best few of each named kind;
  // every candidate's path still reaches the model.
  const sampled = [
    ...new Map(
      [
        ...candidates.slice(0, SNIPPETS_TOTAL),
        ...KINDS.flatMap(({ kind }) => candidates.filter(c => c.kind === kind).slice(0, SNIPPETS_PER_KIND)),
      ].map(c => [c.path, c]),
    ).values(),
  ]
  const workbooks = sampled.filter(c => /\.xls[xm]$/i.test(c.path)).map(c => c.path)
  const { texts, warning } = await readBooks($, root, workbooks)
  if (warning) warnings.push(warning)
  for (const c of sampled) {
    if (/\.(md|markdown|txt)$/i.test(c.path)) {
      const text = await $.fs.read(fullPath(root, c.path)).catch(() => '')
      if (typeof text === 'string') texts.set(c.path, text.slice(0, 1500))
    }
  }
  const ranked = candidates.map(c => {
    const snippet = texts.get(c.path) ?? ''
    return snippet ? { ...c, snippet, score: keywordScore(words, `${c.path} ${snippet}`) } : c
  })

  let links: DocLink[] | undefined
  const answer = await $.model
    .complete({
      model: RANK_MODEL,
      system: RANK_SYSTEM,
      prompt: buildRankPrompt(task, ranked),
      maxTokens: 1500,
      timeoutMs: 90_000,
    })
    .catch(() => undefined)
  if (answer?.isAnswered) links = parseRanking(answer.text, ranked)
  if (links === undefined) {
    const why = answer === undefined ? '调用失败' : answer.isAnswered ? '回复无法解析' : answer.reason
    warnings.push(`AI 判断失败（${why}），已改用关键词匹配。`)
    links = fallbackRanking(ranked)
  }
  // No named kind found in the scan stays empty: its best document is filled in.
  links = coverKinds(links, ranked)

  // Each linked file's SHA256 and time now: the base its later changes are told against.
  const sensed = await senseFiles($, root, links.map(l => l.path))
  if (sensed === undefined) warnings.push(NO_PYTHON_HASH)
  return {
    at,
    checkedAt: sensed === undefined ? 0 : at,
    root,
    task: asked.slice(0, 300),
    links: sensed === undefined ? links : withSensed(links, sensed),
    found: candidates.length,
    suggestions,
    warnings,
    error: '',
  }
}

// 检查状态: reads every linked file again; the base stays, so a change shows.
function check($: EngineInterface) {
  return busyWith($, 'check', async () => {
    const r = await loadResult($)
    if (r.links.length === 0) return
    const sensed = await senseFiles($, r.root, r.links.map(l => l.path))
    const others = r.warnings.filter(w => w !== NO_PYTHON_HASH)
    if (sensed === undefined) {
      await saveResult($, { ...r, warnings: [...others, NO_PYTHON_HASH] })
      return
    }
    await saveResult($, { ...r, links: withSensed(r.links, sensed), checkedAt: await $.clock.now(), warnings: others })
  })
}

// 接受修改: the documents as they are now become the new base.
async function accept($: EngineInterface) {
  const r = await loadResult($)
  await saveResult($, { ...r, links: accepted(r.links) })
}

// 移除: drops the link only; the file itself is never touched.
async function unlink($: EngineInterface, path: string) {
  const r = await loadResult($)
  await saveResult($, { ...r, links: r.links.filter(l => l.path !== path) })
  await update($, skip, all => Object.fromEntries(Object.entries(all).filter(([p]) => p !== path)))
}

async function openDoc($: EngineInterface, path: string) {
  const r = await loadResult($)
  const opened = await openInApp($, r.root, path)
  $.ui.toast(
    opened === 'opened'
      ? `已用默认程序打开 ${path}`
      : opened === 'missing'
        ? `找不到 ${path}，它可能已被移动或删除`
        : `没能打开 ${path}`,
  )
}

// 📂 文件夹: the document's folder, with the document selected.
async function revealDoc($: EngineInterface, path: string) {
  const r = await loadResult($)
  const shown = await revealInFolder($, r.root, path)
  $.ui.toast(
    shown === 'opened'
      ? `已打开 ${path} 所在的文件夹`
      : shown === 'missing'
        ? `找不到 ${path} 和它所在的文件夹`
        : `没能打开 ${path} 所在的文件夹`,
  )
}

// ➕ 加入 on a suggested folder.
async function addSuggested($: EngineInterface, folder: string) {
  $.ui.toast(await addFolder($, folder))
}

// ➕ 添加文档目录: the command goes into the prompt box; the person types the path and sends it.
async function startAddFolder($: EngineInterface) {
  const filled = await $.prompt.fill({ text: '/doc-links add ', mode: 'replace' })
  if (!filled.isFilled) $.ui.toast('在输入框里输入：/doc-links add <文件夹路径>')
}

// Every update goes this one way: each doc's SHA256 is taken first, then Claude is
// handed the fixed prompt; when that turn ends, verifyUpdate compares.
async function submitUpdate($: EngineInterface, links: readonly DocLink[]) {
  if (links.length === 0) return
  const r = await loadResult($)
  const sensed = await senseFiles($, r.root, links.map(l => l.path))
  const before = Object.fromEntries(
    links.map(l => {
      const s = sensed?.get(l.path)
      return [l.path, s === undefined || s === 'missing' ? '' : s.sha256]
    }),
  )
  await update($, syncBefore, () => before)
  await update($, syncPhase, () => 'submitted')
  await update($, syncUnchanged, () => [])
  // Sent as the person's words: only the template and paths found on disk.
  await $.prompt.submit({ text: buildUpdatePrompt(links), asUser: true })
  const at = await $.clock.now()
  await update($, sentAt, () => at)
  $.ui.toast(`已把 ${links.length} 份文档的更新交给 Claude`)
}

async function sendUpdate($: EngineInterface) {
  const r = await loadResult($)
  const off = await read($, skip)
  await update($, confirm, () => false)
  await update($, syncNote, () => '')
  await submitUpdate($, r.links.filter(l => !off[l.path]))
}

// 手动更新: the docs the last update left untouched, sent again.
async function retryUnchanged($: EngineInterface) {
  const r = await loadResult($)
  const left = new Set(await read($, syncUnchanged))
  await update($, syncNote, () => `已把 ${left.size} 份没更新的文档再次交给 Claude。`)
  await submitUpdate($, r.links.filter(l => left.has(l.path)))
}

// A review's code changes are done: link docs if none are linked yet, then update them.
async function updateAfterReview($: EngineInterface) {
  if ((await loadResult($)).links.length === 0) await link($)
  const r = await loadResult($)
  const off = await read($, skip)
  const chosen = r.links.filter(l => !off[l.path])
  if (chosen.length === 0) {
    await update($, syncNote, () => 'review 修改已完成，但没有找到关联文档，没有自动更新。')
    return
  }
  await update($, syncNote, () => `review 修改已完成，已自动把 ${chosen.length} 份关联文档的更新交给 Claude。`)
  await submitUpdate($, chosen)
  void openDocPane($)
}

// The update turn ended: a doc whose SHA256 did not move was not updated.
async function verifyUpdate($: EngineInterface) {
  const before = await read($, syncBefore)
  const paths = Object.keys(before)
  await update($, syncPhase, () => '')
  if (paths.length === 0) return
  const r = await loadResult($)
  const sensed = await senseFiles($, r.root, paths)
  if (sensed === undefined) {
    await update($, syncNote, () => '没能用 Python 计算 SHA256，无法核对文档是否已更新。')
    return
  }
  const left = unchangedDocs(before, sensed)
  await saveResult($, { ...r, links: withSensed(r.links, sensed), checkedAt: await $.clock.now() })
  await update($, syncUnchanged, () => left)
  await update($, syncNote, () =>
    left.length === 0
      ? `文档已更新：${paths.length} 份的 SHA256 都已变化。`
      : `有 ${left.length} 份文档的 SHA256 没有变化，没有更新。`,
  )
}

// The doc pane's part of session start, called from the plugin's one session.start hook.
export async function startDocLinks($: EngineInterface) {
  await update($, busy, () => '')
  await update($, confirm, () => false)
  await $.command.register({
    name: 'doc-links',
    description: '打开关联文档面板；add <路径> / remove <路径> / list 管理额外文档目录',
  })
}

const STATUS_COLOR: Record<DocStatus, string | undefined> = {
  same: undefined,
  changed: 'yellow',
  missing: 'red',
  unknown: undefined,
}

export function registerDocLinks(on: On) {
  // `/doc-links` opens the pane; `add <路径>` / `remove <路径>` / `list` manage the extra folders.
  on('command.run', { command: 'doc-links' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = e.args.trim().slice(verb.length).trim()
    if (verb === 'add' && rest.length > 0) return { text: await addFolder($, arg) }
    if ((verb === 'remove' || verb === 'rm') && rest.length > 0) return { text: await removeFolder($, arg) }
    if (verb === 'list' || verb === 'folders') return { text: await listFolders($) }
    await openDocPane($)
    return { text: '已打开关联文档面板，点「智能关联」才会开始。另一个文件夹里的文档用 /doc-links add <路径> 加入。' }
  })

  // Notices a review the person asks for. Never changes or holds the prompt.
  on('prompt.submit', async ($, e, next) => {
    try {
      if (e.origin.kind !== 'plugin' && (isReviewText(e.text) || isReviewText(e.command?.name ?? ''))) {
        await update($, syncReview, () => true)
      }
    } catch {
      // The sync is a helper: it never stands in the prompt's way.
    }
    return next(e)
  })

  // Marks the turn that runs the update prompt: only that turn's end is verified, so a
  // question the person asks while the prompt waits is never taken for the update.
  // (A plugin's own prompt does not pass its own prompt.submit hook; turn.start sees every turn.)
  on('turn.start', async ($, e, next) => {
    try {
      if (e.agentId === undefined && e.text.startsWith(UPDATE_HEADER) && (await read($, syncPhase)) === 'submitted') {
        await update($, syncPhase, () => 'update-turn')
      }
    } catch {
      // Never in a turn's way.
    }
    return next(e)
  })

  // Notices a review skill or review agent, and the code files a turn changes.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    try {
      const input = e as unknown as Record<string, unknown>
      const said = `${String(input.skill ?? '')} ${String(input.description ?? '')} ${String(input.subagent_type ?? '')}`
      if ((e.tool === 'Skill' || e.tool === 'Agent') && isReviewText(said)) {
        await update($, syncReview, () => true)
      }
      const path = editedPath(e.tool, input)
      const isDone = !('deny' in result && result.deny) && result.isError !== true
      if (path !== '' && isDone && isCodePath(path) && (await read($, syncPhase)) === '') {
        await update($, syncEdited, list => (list.includes(path) ? list : [...list, path].slice(-50)))
      }
    } catch {
      // Never in a tool call's way.
    }
    return result
  })

  // At a main-loop turn's end: verify an update turn, or start the update a review's code changes call for.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    try {
      const phase = await read($, syncPhase)
      const edited = await read($, syncEdited)
      await update($, syncEdited, () => [])
      if (phase === 'update-turn') {
        await verifyUpdate($)
      } else if (phase === '' && !e.isAborted && edited.length > 0 && (await read($, syncReview))) {
        await update($, syncReview, () => false)
        // Linking may ask the model: it runs on after the turn, not in its way.
        void updateAfterReview($).catch(async (err: unknown) => {
          await update($, syncNote, () => `review 后自动更新文档失败：${String(err)}`)
        })
      }
    } catch {
      // Never in a turn's way.
    }
    return done
  })

  on('ui.render', { component: 'Pane', requestId: DOC_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const r = await loadResult($)
    const doing = await read($, busy)
    const asking = await read($, confirm)
    const off = await read($, skip)
    const sent = await read($, sentAt)
    const isReview = await read($, syncReview)
    const phase = await read($, syncPhase)
    const said = await read($, syncNote)
    const left = await read($, syncUnchanged)
    const folders = await shownFolders($)
    const openKinds = await read($, kindOpen)
    const footer = await buildFooter($, e)
    const now = await $.clock.now()
    const chosen = r.links.filter(l => !off[l.path])
    const changed = r.links.filter(l => docStatus(l) === 'changed').length
    const latest = r.task.replace(/\s+/g, ' ')

    const status =
      doing === 'link'
        ? '⏳ 正在扫描文档并请 AI 判断…'
        : doing === 'check'
          ? '⏳ 正在计算 SHA256…'
          : r.at === 0
            ? '点「智能关联」：按本会话最近的提问，从项目文档里找相关的要件定义、设计和测试设计。'
            : [
                `上次关联 ${relTime(r.at, now)}`,
                `识别到 ${r.found} 份文档`,
                `关联 ${r.links.length} 份`,
                ...(r.checkedAt ? [`上次检查 ${relTime(r.checkedAt, now)}`] : []),
                ...(changed ? [`已修改 ${changed} 份`] : []),
              ].join(' · ')

    return (
      <Box flexDirection="column">
        <Box>
          <Button key="doc-link" label={doing === 'link' ? '⏳ 关联中…' : '🔗 智能关联'} onPress={() => link($)} />
          {r.links.length > 0 && (
            <Button key="doc-check" label={doing === 'check' ? '⏳ 检查中…' : '🔄 检查状态'} onPress={() => check($)} />
          )}
          {changed > 0 && <Button key="doc-accept" label={`✔ 接受修改（${changed}）`} onPress={() => accept($)} />}
        </Box>
        <Text dimColor wrap="truncate-end">
          {latest ? `任务：${latest}` : '点「智能关联」时，按本会话记录判断当前任务'}
        </Text>
        <Text color={changed > 0 && doing === '' ? 'yellow' : undefined} dimColor={changed === 0}>
          {status}
        </Text>
        {r.warnings.map(w => (
          <Text color="yellow">⚠ {w}</Text>
        ))}
        {isReview && phase === '' && (
          <Text dimColor>🔁 已检测到 review：代码修改的那一轮结束后，会自动更新关联文档。</Text>
        )}
        {phase !== '' && <Text dimColor>⏳ 等 Claude 更新文档，那一轮结束后自动核对 SHA256。</Text>}
        {said !== '' && <Text color={left.length > 0 ? 'yellow' : 'green'}>🔁 {said}</Text>}
        {left.length > 0 && phase === '' && (
          <Box flexDirection="column">
            {left.map(p => (
              <Text color="yellow" wrap="truncate-start">
                {'  '}· {p}
              </Text>
            ))}
            <Box>
              <Button key="doc-sync-retry" label={`📝 手动更新这些文档（${left.length}）`} onPress={() => retryUnchanged($)} />
            </Box>
          </Box>
        )}
        <Box flexDirection="column">
          <Box>
            <Text dimColor>
              {folders.length === 0 ? '文档在另一个文件夹？' : `额外文档目录（${folders.length}）：`}
            </Text>
            <Button key="doc-folder-add" label="➕ 添加文档目录" dimColor onPress={() => startAddFolder($)} />
          </Box>
          {(r.suggestions ?? []).map(s => (
            <Box>
              <Box flexShrink={0}>
                <Button key={`doc-folder-suggest-${s}`} label="➕ 固定加入" onPress={() => addSuggested($, s)} />
              </Box>
              <Box flexGrow={1} flexShrink={1} marginLeft={1}>
                <Text color="cyan" wrap="truncate-start">
                  相邻文件夹（已自动一起扫描）：{s}
                </Text>
              </Box>
            </Box>
          ))}
          {folders.map(f => (
            <Box>
              <Box flexShrink={0}>
                <Button key={`doc-folder-remove-${f}`} label="✕" dimColor onPress={() => removeFolder($, f)} />
              </Box>
              <Box flexGrow={1} flexShrink={1} marginLeft={1}>
                <Text dimColor wrap="truncate-start">
                  {f}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
        {r.error !== '' && <Text color="red">{r.error}</Text>}

        {r.at !== 0 &&
          (r.error === '' || r.links.length > 0) &&
          KINDS.filter(k => k.kind !== 'other' || r.links.some(l => l.kind === 'other')).map(({ kind, label }) => {
            const links = r.links.filter(l => l.kind === kind)
            const isOpen = openKinds[kind] === true && links.length > 0
            return (
              <Box flexDirection="column" marginTop={1}>
                <Box>
                  {links.length > 0 && (
                    <Button
                      key={`doc-kind-${kind}`}
                      label={isOpen ? '▼' : '▶'}
                      plain
                      onPress={() => update($, kindOpen, all => ({ ...all, [kind]: !all[kind] }))}
                    />
                  )}
                  <Text bold dimColor={links.length === 0}>
                    {' '}
                    {label}（{links.length}）
                  </Text>
                  {links.length === 0 && <Text dimColor> 未找到相关文档</Text>}
                </Box>
                {isOpen && links.map(l => {
                  const state = docStatus(l)
                  const shown = l.now ?? l.base
                  return (
                    // A keyed Box is a hover scope: the pointer over it shows the full SHA256.
                    <Box key={`doc-row-${l.path}`} flexDirection="column" paddingLeft={1}>
                      <Box>
                        <Box flexShrink={0}>
                          <Button
                            key={`doc-pick-${l.path}`}
                            label={off[l.path] ? '☐' : '☑'}
                            onPress={() => update($, skip, all => ({ ...all, [l.path]: !all[l.path] }))}
                          />
                          <Button key={`doc-open-${l.path}`} label="📄 打开" onPress={() => openDoc($, l.path)} />
                          <Button key={`doc-reveal-${l.path}`} label="📂 文件夹" onPress={() => revealDoc($, l.path)} />
                          <Button key={`doc-remove-${l.path}`} label="✕ 移除" onPress={() => unlink($, l.path)} />
                        </Box>
                        <Box flexGrow={1} flexShrink={1} marginLeft={1}>
                          <Text wrap="truncate-start" dimColor={off[l.path] === true}>
                            {l.path}
                          </Text>
                        </Box>
                      </Box>
                      <Box paddingLeft={4}>
                        <Text color={STATUS_COLOR[state]} dimColor={state === 'same' || state === 'unknown'} wrap="truncate-end">
                          {shown ? `SHA256 ${shown.sha256.slice(0, 16)}… · 修改于 ${fullTime(shown.mtimeMs)} · ` : ''}
                          {STATUS_TEXT[state]}
                        </Text>
                      </Box>
                      {l.reason !== '' && (
                        <Box paddingLeft={4}>
                          <Text dimColor wrap="truncate-end">
                            {l.reason}
                          </Text>
                        </Box>
                      )}
                      {shown && (
                        <Box display="none" hover={{ display: 'flex' }} flexDirection="column" paddingLeft={4}>
                          <Text dimColor wrap="wrap">
                            当前 SHA256 {shown.sha256} · {shown.size} 字节
                          </Text>
                          {state === 'changed' && l.base && (
                            <Text dimColor wrap="wrap">
                              关联时 SHA256 {l.base.sha256} · 修改于 {fullTime(l.base.mtimeMs)}
                            </Text>
                          )}
                        </Box>
                      )}
                    </Box>
                  )
                })}
              </Box>
            )
          })}

        {chosen.length > 0 && !asking && (
          <Box marginTop={1}>
            <Button
              key="doc-update"
              label={`📝 按本任务改动更新选中的 ${chosen.length} 份文档`}
              onPress={() => update($, confirm, () => true)}
            />
          </Box>
        )}
        {chosen.length > 0 && asking && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">将让 Claude 按本任务的改动修改这 {chosen.length} 份文档（不提交）：</Text>
            {chosen.map(l => (
              <Text color="yellow" wrap="truncate-start">
                · {l.path}
              </Text>
            ))}
            <Box>
              <Button key="doc-update-confirm" label="确认更新" onPress={() => sendUpdate($)} />
              <Button key="doc-update-cancel" label="取消" onPress={() => update($, confirm, () => false)} />
            </Box>
          </Box>
        )}
        {sent !== 0 && phase === '' && <Text dimColor>上次于 {relTime(sent, now)} 把更新交给 Claude。</Text>}
        {footer}
      </Box>
    )
  })
}
