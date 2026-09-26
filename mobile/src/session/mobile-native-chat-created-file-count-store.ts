// Reads back the created files the wire cut, for the rows on screen that show
// one, and keeps the verdicts. See mobile-native-chat-created-file-count.ts
// for what makes a file provably the create's.
//
// A file is read only while a mounted row wants it (a finished run that draws
// a count), only once the loaded transcript holds its create untouched, at
// most two at a time, and once for the host and worktree the chat shows: a
// verdict, counted or refused, is kept across reconnects for as long as the
// chat shows them, and only a read that failed is asked again, once per new
// connection (CLAUDE.md, "Nothing stays stale once the relay connects"). A
// later call that touches the file drops its count at once.
//
// Reads go out only from the chat's own settled transcript, and after a new
// connection or a move only once that connection's transcript is in: the
// one held until then may lack the calls the agent made while the phone was
// away, or belong to the last worktree. A verdict holds only for the message
// its create was read in, so the same create in another session reads again.

import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import {
  createStaleAfterReconnectLedger,
  shouldRefetchAfterReconnect
} from '../transport/stale-after-reconnect'
import {
  cutCreateStandings,
  judgeCreatedFile,
  type CreatedFileRefusal,
  type CutCreate,
  type CutCreateStanding
} from './mobile-native-chat-created-file-count'
import { readCreatedFile, type CreatedFileReadSender } from './mobile-native-chat-created-file-read'

const MAX_READS_IN_FLIGHT = 2

export type CreatedFileCountScope = {
  client: CreatedFileReadSender | null
  hostId: string
  worktreeId: string
  lastConnectedAt: number | null
}

export type CreatedFileCountStore = {
  configure(scope: CreatedFileCountScope): void
  /** The chat's loaded transcript. `live` is false while the chat still holds
   *  one over from before its own read settled. */
  setTranscript(messages: readonly NativeChatMessage[], live: boolean): void
  /** A mounted row shows this create. Returns its release. */
  want(create: CutCreate): () => void
  /** The create's verified count, or null for no number. */
  countFor(key: string): number | null
  subscribe(listener: () => void): () => void
}

type Entry = {
  create: CutCreate
  wants: number
  state: 'idle' | 'queued' | 'reading' | 'counted' | 'settled' | 'failed'
  added: number | null
  /** The message holding the create the verdict was read for. */
  readFor: string | null
}

/** Which scope, connection and create a read went out for. */
type Issued = { generation: number; on: number | null; messageId: string }

/** What one read found, before it is written into its entry. */
type Landing = { state: 'counted' | 'settled' | 'failed'; added: number | null; why?: string }

const REFUSAL_WORDS: Record<CreatedFileRefusal, string> = {
  'cut-read': 'the host cut the read at its size cap',
  binary: 'binary',
  changed: 'changed since the create',
  uncountable: 'too long to count'
}

function noCount(path: string, reason: string): void {
  console.warn(`[created-file-count] no count for ${path}: ${reason}`)
}

export function createCreatedFileCountStore(): CreatedFileCountStore {
  const listeners = new Set<() => void>()
  const entries = new Map<string, Entry>()
  const ledger = createStaleAfterReconnectLedger()
  let queue: string[] = []
  let inFlight = 0
  /** Moves on every scope change, so a read from the old scope lands nowhere. */
  let generation = 0
  let scope: CreatedFileCountScope | null = null
  let transcript: readonly NativeChatMessage[] = []
  let transcriptLive = false
  /** Set when the connection or the scope changes, and cleared by the next
   *  live transcript: until then the transcript in hand may lack calls the
   *  agent made while the phone was away, or belong to the last worktree. */
  let awaitingTranscript = false
  let standings: Map<string, CutCreateStanding> | null = null

  const notify = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }

  const standingOf = (key: string): CutCreateStanding | undefined => {
    standings ??= cutCreateStandings(transcript)
    return standings.get(key)
  }

  /** Present in the loaded transcript, and nothing after it named the file. */
  const provable = (key: string): boolean => standingOf(key)?.touched === false

  /** A verdict holds only for the create it was read for. The same path and
   *  kept prefix in another message, a task run again in a new session, is
   *  another create, and maybe another file. An empty or reloading transcript
   *  names no message, and forgets nothing. */
  const forgetIfAnotherCreate = (entry: Entry): boolean => {
    const holder = standingOf(entry.create.key)?.messageId
    if (entry.readFor === null || holder === undefined || holder === entry.readFor) {
      return false
    }
    if (entry.state === 'counted' || entry.state === 'settled' || entry.state === 'failed') {
      entry.state = 'idle'
      entry.added = null
      entry.readFor = null
      return true
    }
    return false
  }

  const enqueue = (entry: Entry): void => {
    if (entry.state === 'idle' && entry.wants > 0 && provable(entry.create.key)) {
      entry.state = 'queued'
      queue.push(entry.create.key)
    }
  }

  /** Never rejects: a rejected send is a failed read like any other. */
  const read = async (
    create: CutCreate,
    client: CreatedFileReadSender,
    worktreeId: string
  ): Promise<Landing> => {
    try {
      const outcome = await readCreatedFile({ client, worktreeId, path: create.path })
      if (outcome.kind === 'failed') {
        return { state: 'failed', added: null, why: outcome.reason }
      }
      if (outcome.kind === 'refused') {
        return { state: 'settled', added: null, why: outcome.reason }
      }
      const verdict = judgeCreatedFile(create, outcome)
      return verdict.kind === 'refused'
        ? { state: 'settled', added: null, why: REFUSAL_WORDS[verdict.reason] }
        : { state: 'counted', added: verdict.added }
    } catch (error: unknown) {
      return { state: 'failed', added: null, why: String(error) }
    }
  }

  /** Writes a read's finding into its entry, unless the chat moved to another
   *  host or worktree while it was out: the entry then belongs to the new
   *  scope, and the old scope's file says nothing about it. */
  const land = (entry: Entry, issued: Issued, found: Landing) => {
    if (issued.generation !== generation) {
      return
    }
    inFlight -= 1
    entry.state = found.state
    entry.added = found.added
    entry.readFor = issued.messageId
    const key = entry.create.key
    if (found.state === 'failed') {
      noCount(entry.create.path, `${found.why}; asking again on the next connection`)
      // Recorded against the connection the read went out on, so a failure
      // that lands after a reconnect is retried now, not one connection late.
      shouldRefetchAfterReconnect(ledger, key, 'error', issued.on)
      if (shouldRefetchAfterReconnect(ledger, key, 'error', scope?.lastConnectedAt ?? null)) {
        entry.state = 'idle'
        enqueue(entry)
      }
    } else {
      if (found.why) {
        noCount(entry.create.path, found.why)
      }
      shouldRefetchAfterReconnect(ledger, key, 'ready', null)
    }
    if (forgetIfAnotherCreate(entry)) {
      enqueue(entry)
    }
    notify()
    pump()
  }

  function pump(): void {
    const current = scope
    if (!current?.client || !transcriptLive || awaitingTranscript) {
      return
    }
    while (inFlight < MAX_READS_IN_FLIGHT && queue.length > 0) {
      const key = queue.shift()!
      const entry = entries.get(key)
      if (!entry || entry.state !== 'queued') {
        continue
      }
      if (entry.wants === 0 || !provable(key)) {
        entry.state = 'idle'
        continue
      }
      entry.state = 'reading'
      inFlight += 1
      const issued: Issued = {
        generation,
        on: current.lastConnectedAt,
        messageId: standingOf(key)!.messageId
      }
      void read(entry.create, current.client, current.worktreeId).then((found) =>
        land(entry, issued, found)
      )
    }
  }

  const reset = (): void => {
    generation += 1
    queue = []
    inFlight = 0
    ledger.clear()
    for (const entry of entries.values()) {
      entry.state = 'idle'
      entry.added = null
      entry.readFor = null
    }
  }

  return {
    configure(next) {
      const previous = scope
      scope = next
      const moved =
        previous !== null &&
        (previous.hostId !== next.hostId || previous.worktreeId !== next.worktreeId)
      if (moved) {
        reset()
      }
      if (moved || (previous !== null && previous.lastConnectedAt !== next.lastConnectedAt)) {
        awaitingTranscript = true
      }
      for (const entry of entries.values()) {
        if (moved) {
          enqueue(entry)
        } else if (
          entry.state === 'failed' &&
          shouldRefetchAfterReconnect(ledger, entry.create.key, 'error', next.lastConnectedAt)
        ) {
          entry.state = 'idle'
          enqueue(entry)
        }
      }
      if (moved) {
        notify()
      }
      pump()
    },
    setTranscript(messages, live) {
      transcriptLive = live
      if (messages !== transcript) {
        transcript = messages
        standings = null
        if (live) {
          awaitingTranscript = false
        }
        for (const entry of entries.values()) {
          forgetIfAnotherCreate(entry)
          enqueue(entry)
        }
        notify()
      }
      pump()
    },
    want(create) {
      let entry = entries.get(create.key)
      if (!entry) {
        entry = { create, wants: 0, state: 'idle', added: null, readFor: null }
        entries.set(create.key, entry)
      }
      entry.wants += 1
      enqueue(entry)
      pump()
      const wanted = entry
      let released = false
      return () => {
        if (released) {
          return
        }
        released = true
        wanted.wants -= 1
        if (wanted.wants === 0 && wanted.state === 'queued') {
          wanted.state = 'idle'
          queue = queue.filter((key) => key !== wanted.create.key)
        }
      }
    },
    countFor(key) {
      const entry = entries.get(key)
      return entry?.state === 'counted' && provable(key) ? entry.added : null
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
