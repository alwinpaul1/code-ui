// Which Codex models this session can actually pick.
//
// The host's `codex debug models` probe runs against ~/.codex, not the home the
// Orca-launched Codex uses, and its parser drops `visibility` — so it listed
// hidden models (Daybreak, Codex Auto Review) and missed one the account has
// (gpt-5.3-codex-spark). The one source that is exactly right for the running
// session is Codex's own `/model` picker: open it, read the rows, escape. Cached
// per host+worktree for the process; the account's list does not move mid-day.
import { escapeCodexPicker, waitForCodexPickerStep, type CodexPickerIo } from './codex-picker-apply'
import { isCodexIdle, parseCodexPickerScreen } from './codex-picker-screen'
import { readCodexModelList, writeCodexModelList } from '../storage/codex-model-lists'

export type CodexVisibleModel = {
  slug: string
  description: string
  isDefault: boolean
  isCurrent: boolean
}

const cache = new Map<string, CodexVisibleModel[]>()
/** The last list a scrape wrote to disk, shown until this process scrapes. */
const persisted = new Map<string, CodexVisibleModel[]>()
const listeners = new Set<() => void>()
const inFlight = new Set<string>()
const hydrating = new Map<string, Promise<void>>()

function isVisibleModel(value: unknown): value is CodexVisibleModel {
  const row = value as Partial<CodexVisibleModel> | null
  return (
    typeof row?.slug === 'string' &&
    row.slug.length > 0 &&
    typeof row.description === 'string' &&
    typeof row.isDefault === 'boolean' &&
    typeof row.isCurrent === 'boolean'
  )
}

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function codexVisibleModelsKey(hostId: string, worktreeId: string): string {
  return `${hostId}\0${worktreeId}`
}

/** This process's scrape, else the persisted copy from an earlier run. */
export function peekCodexVisibleModels(key: string): CodexVisibleModel[] | null {
  return cache.get(key) ?? persisted.get(key) ?? null
}

/** True once Codex's picker has been read in this process (a persisted copy
 *  is shown meanwhile but does not count: the plan may have changed). */
export function hasScrapedCodexVisibleModels(key: string): boolean {
  return cache.has(key)
}

/** Load the persisted list so a cold open shows models at once. */
export function hydrateCodexVisibleModels(key: string): Promise<void> {
  if (cache.has(key) || persisted.has(key)) {
    return Promise.resolve()
  }
  const pending = hydrating.get(key)
  if (pending) {
    return pending
  }
  const run = readCodexModelList('visible', key, isVisibleModel)
    .then((stored) => {
      if (stored && !cache.has(key) && !persisted.has(key)) {
        persisted.set(key, stored)
        notify()
      }
    })
    .finally(() => {
      hydrating.delete(key)
    })
  hydrating.set(key, run)
  return run
}

export function subscribeCodexVisibleModels(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetCodexVisibleModelsForTests(): void {
  cache.clear()
  persisted.clear()
  hydrating.clear()
  inFlight.clear()
}

/** Open the picker, read the model rows, close it. Only when the TUI is idle at
 *  its prompt; a picker already open is escaped first. Null when it could not be
 *  read this time (the next open retries). */
export async function scrapeCodexVisibleModels(
  io: CodexPickerIo,
  key: string,
  initialScreen?: string[]
): Promise<CodexVisibleModel[] | null> {
  if (inFlight.has(key)) {
    return null
  }
  inFlight.add(key)
  try {
    let lines = initialScreen ?? (await io.readScreen())
    let step = parseCodexPickerScreen(lines)
    if (step?.step !== 'model') {
      if (step) {
        await escapeCodexPicker(io)
        lines = await io.readScreen()
      }
      if (!isCodexIdle(lines)) {
        return null
      }
      if (!(await io.typeCommand('/model'))) {
        return null
      }
      step = await waitForCodexPickerStep(io, 'model', 5_000)
    }
    if (!step) {
      await escapeCodexPicker(io)
      return null
    }
    const models = step.rows.map((row) => ({
      slug: row.name,
      description: row.description,
      isDefault: row.isDefault,
      isCurrent: row.isCurrent
    }))
    if (models.length === 0) {
      return null
    }
    cache.set(key, models)
    void writeCodexModelList('visible', key, models)
    // The list is already verified. Publish it before the extra relay round
    // trips needed to close the picker; callers still hold the terminal lock
    // until cleanup ends, so a selection cannot interleave keystrokes.
    notify()
    await escapeCodexPicker(io)
    return models
  } finally {
    inFlight.delete(key)
  }
}
