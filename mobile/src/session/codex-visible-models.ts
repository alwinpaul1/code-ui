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

export type CodexVisibleModel = {
  slug: string
  description: string
  isDefault: boolean
  isCurrent: boolean
}

const cache = new Map<string, CodexVisibleModel[]>()
const listeners = new Set<() => void>()
const inFlight = new Set<string>()

export function codexVisibleModelsKey(hostId: string, worktreeId: string): string {
  return `${hostId}\0${worktreeId}`
}

export function peekCodexVisibleModels(key: string): CodexVisibleModel[] | null {
  return cache.get(key) ?? null
}

export function subscribeCodexVisibleModels(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetCodexVisibleModelsForTests(): void {
  cache.clear()
  inFlight.clear()
}

/** Open the picker, read the model rows, close it. Only when the TUI is idle at
 *  its prompt; a picker already open is escaped first. Null when it could not be
 *  read this time (the next open retries). */
export async function scrapeCodexVisibleModels(
  io: CodexPickerIo,
  key: string
): Promise<CodexVisibleModel[] | null> {
  if (inFlight.has(key)) {
    return null
  }
  inFlight.add(key)
  try {
    let lines = await io.readScreen()
    if (parseCodexPickerScreen(lines)) {
      await escapeCodexPicker(io)
      lines = await io.readScreen()
    }
    if (!isCodexIdle(lines)) {
      return null
    }
    if (!(await io.typeCommand('/model'))) {
      return null
    }
    const step = await waitForCodexPickerStep(io, 'model', 5_000)
    await escapeCodexPicker(io)
    if (!step) {
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
    for (const listener of listeners) {
      listener()
    }
    return models
  } finally {
    inFlight.delete(key)
  }
}
