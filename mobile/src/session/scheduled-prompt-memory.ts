import { cutWholeCharacters } from '../text/whole-character-cut'
import { createPersistedMap } from './session-cache-persistence'

/**
 * The loop prompts a Claude session has shown the chat, kept per session.
 *
 * The chat knows a tick by the CronCreate or ScheduleWakeup call that set its
 * loop up (scheduled-prompt-ticks.ts), and finds that call only on the pages
 * it has loaded: once the call scrolled out, or after a relaunch whose first
 * page no longer held it, every tick drew a user bubble again (2026-10-01).
 * So each prompt seen is kept here, folded, for the session's life on this
 * phone: a loop dies with its Claude session (CronCreate says "Session-only"),
 * so a session id keys it and nothing carries over to another.
 *
 * Kept for this run, and for the next one as the other session caches are
 * (session-cache-persistence.ts: one blob, read at app start, written after a
 * debounce, and fail-open both ways). A loop deleted since is still kept; that
 * costs only a typed copy of its exact words its bubble until its row lands.
 */

/** What the chat matches a desk copy against: folded words, `cut` when they
 *  are a prefix of the prompt. */
export type RememberedScheduledPrompt = { words: string; cut?: true }

const PROMPTS_PER_SESSION = 16
const SESSIONS = 32
/** As much as Claude Code's own Stop payload keeps of a cron prompt. */
const WORDS_KEPT = 1000
const NONE: readonly RememberedScheduledPrompt[] = []

const kept = createPersistedMap<RememberedScheduledPrompt[]>({
  storageKey: 'codeui:chat-scheduled-prompts',
  maxEntries: SESSIONS
})

/** Keeps the prompts the session's loaded transcript scheduled, newest last. */
export function rememberScheduledPrompts(
  sessionId: string | null | undefined,
  prompts: readonly { words: string; cut: boolean }[]
): void {
  if (!sessionId || prompts.length === 0) {
    return
  }
  const held = kept.get(sessionId) ?? []
  const next = [...held]
  for (const prompt of prompts) {
    const long = prompt.words.length > WORDS_KEPT
    const words = long ? cutWholeCharacters(prompt.words, WORDS_KEPT) : prompt.words
    if (!words) {
      continue
    }
    const at = next.findIndex((entry) => entry.words === words)
    if (at !== -1) {
      next.splice(at, 1)
    }
    next.push(long || prompt.cut ? { words, cut: true } : { words })
  }
  const capped = next.slice(-PROMPTS_PER_SESSION)
  if (JSON.stringify(capped) !== JSON.stringify(held)) {
    kept.set(sessionId, capped)
  }
}

/** The prompts kept for the session, or none. The same array until a new
 *  one is kept. */
export function rememberedScheduledPrompts(
  sessionId: string | null | undefined
): readonly RememberedScheduledPrompt[] {
  return (sessionId ? kept.get(sessionId) : undefined) ?? NONE
}

/** Read at app start with the other session caches; never rejects. */
export function hydrateScheduledPromptMemory(): Promise<void> {
  return kept.hydrate()
}

/** Test-only: a fresh process, with storage left as it is. */
export function resetScheduledPromptMemoryForTests(): void {
  kept.reset()
}
