import AsyncStorage from '@react-native-async-storage/async-storage'
import { barrierAfterWrite } from './refused-write-log'
import { nativeChatOutboxWritesSettled } from './native-chat-outbox'

const DRAFT_PREFIX = 'orca:chatDraft:'

function draftStorageKey(scopeKey: string): string {
  return `${DRAFT_PREFIX}${encodeURIComponent(scopeKey)}`
}

/**
 * Unsent composer text per host+worktree+tab.
 *
 * Why persist: the session route unmounts when the user opens another project,
 * and its drafts were plain component state, so anything half-typed vanished on
 * the way back. Storage survives the unmount (and Android reclaiming the app).
 */
export async function readNativeChatDraft(scopeKey: string): Promise<string | null> {
  const read = await openNativeChatDraftRead(scopeKey)
  try {
    return read.current()
  } finally {
    read.close()
  }
}

/** A draft read that stays open until `close`: `current()` is the stored draft it read with every
 *  append made since it began applied, worked out at the moment it is called. */
export type NativeChatDraftRead = { readonly current: () => string | null; readonly close: () => void }

/**
 * Opens a read of the scope's stored draft. A screen hydrating keeps it open until it TAKES the
 * draft and calls `current()` there: fourth review, 2026-10-17, a send refused a microtask after
 * the read had the draft and before the screen took it skipped the still-unread screen, which then
 * took the draft without the words and saved that over them. Taken at the moment it is used, no
 * gap is left; and an append's record outlives every save while a read that predates it is open.
 */
export async function openNativeChatDraftRead(scopeKey: string): Promise<NativeChatDraftRead> {
  const reader = { at: 0 }
  const close = (): void => {
    readers.delete(reader)
  }
  try {
    // A route can reopen while the send's empty write is still removing the
    // entry; a read that beat it handed the sent text back as the draft. The
    // barrier never rejects, so a failed write in front of it cannot fail
    // this read. With no write in flight the read starts at once, in the
    // caller's own tick, as it always did. A write chained meanwhile is waited for too.
    for (let writing = barriers.get(scopeKey); writing; writing = barriers.get(scopeKey)) {
      await writing
    }
    // Every append made from here on is one this read may miss (third review, 2026-10-17).
    reader.at = draftEpoch
    readers.add(reader)
    const stored = await AsyncStorage.getItem(draftStorageKey(scopeKey))
    const current = (): string | null => {
      const missed = (returns.get(scopeKey) ?? []).filter((entry) => entry.epoch > reader.at)
      return missed.length > 0 ? missed.reduce((draft, entry) => entry.reapply(draft), stored ?? '') || null : stored
    }
    return { current, close }
  } catch {
    close()
    return { current: () => null, close }
  }
}

const barriers = new Map<string, Promise<void>>()

/** Serialized per scope so a slow older write cannot land over a newer draft.
 *  An empty draft removes the entry. `observedAt`, the composer's (nativeChatDraftEpoch when it
 *  read `text`): a save read before words were given back to the scope gets them merged in, so a
 *  debounce that fires with the value it read before them cannot write over them. */
export function writeNativeChatDraft(scopeKey: string, text: string, observedAt?: number): Promise<void> {
  const saved = observedAt === undefined ? text : withReturnsSince(scopeKey, text, observedAt)
  return chainDraftWrite(scopeKey, saved ? 'save' : 'erase', async (key) => {
    if (saved) {
      await AsyncStorage.setItem(key, saved)
      return
    }
    // An erase waits for the outbox: the box empties for a send as the send is written there,
    // and the stored draft is the words' only copy on disk until that write lands
    // (native-chat-outbox.ts). That wait never rejects, so it cannot fail this erase.
    await nativeChatOutboxWritesSettled()
    await AsyncStorage.removeItem(key)
  })
}

/** Counts appends: a composer value read at epoch N already holds every append up to N. */
let draftEpoch = 0
/** Each scope's appends, as the epoch they were made at and the merge they made. */
const returns = new Map<string, { readonly epoch: number; readonly reapply: (stored: string) => string }[]>()
/** Draft reads out now, each with the epoch it read at: the appends after it are kept for it. */
const readers = new Set<{ at: number }>()

/** The epoch now; the composer's persistence reads it as it reads a value (see writeNativeChatDraft). */
export function nativeChatDraftEpoch(): number {
  return draftEpoch
}

/** `text` with every append made after `observedAt` applied, oldest first. The appends it already
 *  holds are forgotten, unless a read still out started before them. */
function withReturnsSince(scopeKey: string, text: string, observedAt: number): string {
  const missed = (returns.get(scopeKey) ?? []).filter((entry) => entry.epoch > observedAt)
  forgetNativeChatDraftReturns(scopeKey, observedAt)
  return missed.reduce((draft, entry) => entry.reapply(draft), text)
}

/** Forgets `scopeKey`'s appends up to epoch `upTo` that no read still out may have missed: a save
 *  that read them, or an append no screen holds a copy of (its tab is shown nowhere). */
export function forgetNativeChatDraftReturns(scopeKey: string, upTo: number): void {
  const keepAfter = Math.min(upTo, ...[...readers].map((reader) => reader.at))
  const kept = (returns.get(scopeKey) ?? []).filter((entry) => entry.epoch > keepAfter)
  if (kept.length > 0) {
    returns.set(scopeKey, kept)
  } else {
    returns.delete(scopeKey)
  }
}

/**
 * Words added to a scope's stored draft by `next(stored)`, read and written as ONE step on the
 * scope's write chain. Second review of the closed-chat restore, 2026-10-17: a read in one tick
 * and a write in a later one let two appends to one closed tab each read the same draft, and the
 * second dropped the first; and a reopened tab's hydration read (readNativeChatDraft) slipped in
 * between and showed the draft without them. Every read-modify-write of a stored draft goes
 * through here: a refused send's words, open chat or closed (mobile-native-chat-live-drafts.ts),
 * and the Anthropic lane's queue given back on leaving (ccr-composer-send-deps.ts). A composer
 * save or read from before this call gets `reapply` applied too (writeNativeChatDraft,
 * openNativeChatDraftRead), so callers make the append BEFORE they show the words on any screen.
 * A read may already have seen the append's write, so `reapply` must add nothing to a draft that
 * holds the words; `next`, the first application, is never skipped.
 */
export function appendNativeChatDraft(scopeKey: string, next: (stored: string) => string, reapply: (stored: string) => string = next): Promise<string> {
  draftEpoch += 1
  returns.set(scopeKey, [...(returns.get(scopeKey) ?? []), { epoch: draftEpoch, reapply }])
  let written = ''
  return chainDraftWrite(scopeKey, 'save', async (key) => {
    written = next((await AsyncStorage.getItem(key)) ?? '')
    if (written) {
      await AsyncStorage.setItem(key, written)
    }
  }).then(() => written)
}

function chainDraftWrite(scopeKey: string, kind: 'save' | 'erase', run: (key: string) => Promise<void>): Promise<void> {
  const write = (barriers.get(scopeKey) ?? Promise.resolve()).then(() => run(draftStorageKey(scopeKey)))
  const barrier = barrierAfterWrite(write, 'chat draft', kind)
  barriers.set(scopeKey, barrier)
  void barrier.then(() => {
    if (barriers.get(scopeKey) === barrier) {
      barriers.delete(scopeKey)
    }
  })
  return write
}
