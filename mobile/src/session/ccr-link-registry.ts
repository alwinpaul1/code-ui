import { subscribeAnthropicAccountsChanged } from '../dictation/anthropic-accounts-events'
import { CcrSessionLink, type CcrLinkDeps } from './ccr-session-link'
import { ccrTranscriptKey, wipeCcrTranscripts } from './ccr-transcript-persist'

/**
 * The open session links, one per (account, session), shared by every view of a tab (the chat,
 * a peek, a second screen of the same session): two views make one stream, not two.
 *
 * A link closes `CCR_LINK_LINGER_MS` after its last view lets go, so a quick tab switch keeps its
 * stream; it closes at once, and its kept transcript is wiped, when its account signs out on the
 * phone. Another account's links are not touched: two accounts side by side each keep their own
 * stream and their own token (CcrLinkDeps.auth is asked per account).
 */

export const CCR_LINK_LINGER_MS = 30_000

type Entry = { link: CcrSessionLink; refs: number; cancelLinger: (() => void) | null }

const entries = new Map<string, Entry>()
/** The real deps load with import(), as the image pipeline's do (use-ccr-session-images.ts
 *  loadDefaultCcrPipelineDeps): the sign-in store they read pulls the secure store and React
 *  Native's native modules in, which neither the chat's controller nor its tests may load. */
const loadDefaultDeps = (): Promise<CcrLinkDeps> => import('./ccr-session-default-deps').then((module) => module.defaultCcrLinkDeps())
let depsLoader: (() => Promise<CcrLinkDeps>) | null = loadDefaultDeps
let depsPromise: Promise<CcrLinkDeps> | null = null
let lingerTimer: (run: () => void, ms: number) => () => void = (run, ms) => {
  const timer = setTimeout(run, ms)
  return () => clearTimeout(timer)
}

/** Where the registry gets its real deps (set once by the default-deps module, or by a test). */
export function setCcrLinkDepsLoader(load: () => Promise<CcrLinkDeps>): void {
  depsLoader = load
  depsPromise = null
}

function lazyDeps(): CcrLinkDeps {
  const load = (): Promise<CcrLinkDeps> => {
    if (!depsLoader) {
      return Promise.reject(new Error('no session-link deps were set'))
    }
    depsPromise ??= depsLoader()
    return depsPromise
  }
  return {
    fetch: async (url, init) => (await load()).fetch(url, init),
    streamFetch: async (url, init) => (await load()).streamFetch(url, init),
    auth: async (accountId, fresh) => (await load()).auth(accountId, fresh),
    // Pictures are kept as they arrive; until the deps load nothing has arrived to keep.
    keep: (key, dataUri) => (depsPromiseResolved?.keep(key, dataUri) ?? null),
    log: (line) => (depsPromiseResolved?.log ?? ((text: string) => console.log(text)))(line),
    setTimer: (run, ms) => (depsPromiseResolved?.setTimer ?? lingerTimer)(run, ms),
    now: () => (depsPromiseResolved?.now ?? Date.now)()
  }
}

let depsPromiseResolved: CcrLinkDeps | null = null

export type CcrLinkHandle = { link: CcrSessionLink; release: () => void }

/** Takes a view's hold on the link for (account, session), opening it if needed. */
export function acquireCcrLink(accountId: string, sessionId: string): CcrLinkHandle {
  if (depsLoader && !depsPromiseResolved) {
    depsPromise ??= depsLoader()
    void depsPromise.then((deps) => {
      depsPromiseResolved = deps
    }, () => undefined)
  }
  const key = ccrTranscriptKey(accountId, sessionId)
  let entry = entries.get(key)
  if (!entry) {
    entry = { link: new CcrSessionLink(accountId, sessionId, lazyDeps()), refs: 0, cancelLinger: null }
    entries.set(key, entry)
    if (appInBackground) {
      entry.link.pause()
    }
  }
  entry.cancelLinger?.()
  entry.cancelLinger = null
  entry.refs += 1
  entry.link.start()
  const held = entry
  let released = false
  return {
    link: held.link,
    release: () => {
      if (released) {
        return
      }
      released = true
      held.refs -= 1
      if (held.refs > 0 || entries.get(key) !== held) {
        return
      }
      held.cancelLinger = lingerTimer(() => {
        if (held.refs === 0 && entries.get(key) === held) {
          held.link.stop()
          entries.delete(key)
        }
      }, CCR_LINK_LINGER_MS)
    }
  }
}

/** The link for (account, session) if one is open (for tests and the one-tap check). */
export function openCcrLink(accountId: string, sessionId: string): CcrSessionLink | null {
  return entries.get(ccrTranscriptKey(accountId, sessionId))?.link ?? null
}

/** Every open link retries a lost stream now (a relay reconnect). */
export function retryCcrLinks(): void {
  for (const entry of entries.values()) {
    entry.link.retry()
  }
}

/** True while the app is in the background: no link streams, and a link opened meanwhile waits. */
let appInBackground = false

/** The app went to the background (client-context.tsx): every stream closes until the foreground. */
export function pauseCcrLinks(): void {
  appInBackground = true
  for (const entry of entries.values()) {
    entry.link.pause()
  }
}

/** The app is back in front (client-context.tsx): paused streams resume after the last sequence
 *  each held, and lost ones try again. */
export function foregroundCcrLinks(): void {
  appInBackground = false
  for (const entry of entries.values()) {
    entry.link.resume()
  }
}

/** An account signed out (or all of them): its links stop at once and its kept transcripts go. */
export function closeCcrLinksOfAccount(accountId: string | 'all'): void {
  for (const [key, entry] of entries) {
    if (accountId === 'all' || entry.link.accountId === accountId) {
      entry.cancelLinger?.()
      entry.link.stop()
      entries.delete(key)
    }
  }
  wipeCcrTranscripts(accountId)
}

subscribeAnthropicAccountsChanged((change) => {
  if (change.signedOut) {
    closeCcrLinksOfAccount(change.signedOut)
  }
})

export function setCcrLinkTimerForTests(timer: (run: () => void, ms: number) => () => void): void {
  lingerTimer = timer
}

export function resetCcrLinksForTests(): void {
  for (const entry of entries.values()) {
    entry.cancelLinger?.()
    entry.link.stop()
  }
  entries.clear()
  appInBackground = false
  depsLoader = loadDefaultDeps
  depsPromise = null
  depsPromiseResolved = null
  lingerTimer = (run, ms) => {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  }
}
