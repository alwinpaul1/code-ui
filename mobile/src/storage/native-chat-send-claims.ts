import AsyncStorage from '@react-native-async-storage/async-storage'

const CLAIMS_KEY = 'orca:chatSendClaims'
/** A claim older than this is dropped when the store is read: the outbox itself keeps nothing
 *  longer (OUTBOX_PRUNE_AGE_MS), so no send is left that could be told apart by it. */
const CLAIM_PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** The newest claims kept. A claim is one transcript row or one prompt receipt, a few dozen
 *  bytes; this bounds the store for a phone that sends all day for a week. */
const CLAIM_CAP = 500

/**
 * Which send each piece of Claude's record went to: a transcript row, or a prompt receipt (the
 * beacon's `up=` copy, or Orca's `agentStatus.prompt`).
 *
 * Why: on the terminal lane the phone cannot put its id on the wire (Claude Code writes its own
 * uuid into the transcript), so a send is matched to its row by its words. Two sends of the same
 * words ("yes", then "yes") then read the same row, each on its own: the first send's row also
 * "proved" the second one delivered, and a second that never arrived left the outbox with nobody
 * to send it (S1 of docs/claude-app-parity-gaps.md). The Claude app keys its echo by the client
 * uuid; the nearest the phone can come is to write down, by the send's one id, the row or receipt
 * that settled it, so no other send can be settled by the same one, in this process or after a
 * restart.
 *
 * Fail-open: a store that cannot be read or written costs only the restart half (the claims in
 * memory still hold for this run).
 */
type Claim = { kind: 'row' | 'nonce'; key: string; sendId: string; at: number }

let claims = new Map<string, Claim>()
let hydration: Promise<void> | null = null
let readRefused = false
let writes: Promise<void> = Promise.resolve()

const slot = (kind: Claim['kind'], key: string): string => `${kind}:${key}`

function isClaim(value: unknown): value is Claim {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const claim = value as Partial<Claim>
  return (
    (claim.kind === 'row' || claim.kind === 'nonce') &&
    typeof claim.key === 'string' &&
    typeof claim.sendId === 'string' &&
    typeof claim.at === 'number'
  )
}

/** A list that will not parse is no list: it is written over by the next claim. */
function parseStored(raw: string | null): unknown {
  try {
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/** Reads the stored claims once per process; claims made before the read finished stay. */
export function hydrateNativeChatSendClaims(): Promise<void> {
  hydration ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(CLAIMS_KEY)
      const parsed = parseStored(raw)
      const now = Date.now()
      const stored = Array.isArray(parsed)
        ? parsed.filter(isClaim).filter((claim) => claim.kind === 'row' && now - claim.at < CLAIM_PRUNE_AGE_MS)
        : []
      const merged = new Map(stored.map((claim) => [slot(claim.kind, claim.key), claim]))
      for (const [key, claim] of claims) {
        merged.set(key, claim)
      }
      claims = merged
      readRefused = false
    } catch (error) {
      readRefused = true
      console.warn('[storage] could not read the chat send claims; nothing is written over them this run', error)
    }
  })()
  return hydration
}

function persist(): void {
  writes = writes.then(async () => {
    await hydrateNativeChatSendClaims()
    if (readRefused) {
      return
    }
    try {
      const kept = [...claims.values()].sort((a, b) => a.at - b.at).slice(-CLAIM_CAP)
      if (kept.length < claims.size) {
        claims = new Map(kept.map((claim) => [slot(claim.kind, claim.key), claim]))
      }
      // Rows only. A receipt's nonce is a hook pid, or a status copy's counter that starts again
      // in every process: kept across a restart, an old claim hid a new receipt with the same
      // nonce from the send it was for (review of the batch, finding 4).
      await AsyncStorage.setItem(CLAIMS_KEY, JSON.stringify(kept.filter((claim) => claim.kind === 'row')))
    } catch (error) {
      console.warn('[storage] could not save the chat send claims; they hold for this run only', error)
    }
  })
}

function claim(kind: Claim['kind'], key: string, sendId: string): boolean {
  const held = claims.get(slot(kind, key))
  if (held) {
    return held.sendId === sendId
  }
  claims.set(slot(kind, key), { kind, key, sendId, at: Date.now() })
  persist()
  return true
}

/** The transcript row `rowId` settled send `sendId`. False when another send already has it. */
export function claimRowForSend(sendId: string, rowId: string): boolean {
  return claim('row', rowId, sendId)
}

/** The prompt receipt `nonce` settled send `sendId`. False when another send already has it. */
export function claimNonceForSend(sendId: string, nonce: string): boolean {
  return claim('nonce', nonce, sendId)
}

/** The send a transcript row settled, if any. */
export function rowClaimant(rowId: string): string | undefined {
  return claims.get(slot('row', rowId))?.sendId
}

/** The send a prompt receipt settled, if any. */
export function nonceClaimant(nonce: string): string | undefined {
  return claims.get(slot('nonce', nonce))?.sendId
}

/** Whether some transcript row already settled send `sendId`. */
export function sendHasRow(sendId: string): boolean {
  for (const claim of claims.values()) {
    if (claim.kind === 'row' && claim.sendId === sendId) {
      return true
    }
  }
  return false
}

/** Whether `rowId` belongs to a send other than `sendId` (any send, when `sendId` is unknown). */
export function rowClaimedByAnother(rowId: string, sendId: string | undefined): boolean {
  const owner = rowClaimant(rowId)
  return owner !== undefined && owner !== sendId
}

/** Whether `nonce` belongs to a send other than `sendId` (any send, when `sendId` is unknown). */
export function nonceClaimedByAnother(nonce: string, sendId: string | undefined): boolean {
  const owner = nonceClaimant(nonce)
  return owner !== undefined && owner !== sendId
}

/** Settles once every claim write asked for so far has landed or failed. */
export function nativeChatSendClaimWritesSettled(): Promise<void> {
  return writes
}

/** Test-only: the claims are module state. `keepStored` is a process restart: the stored copy is
 *  read again. Without it the store counts as read and empty, so one test's claims never come
 *  back in the next (the AsyncStorage mock outlives a test), and the reset touches no storage
 *  (a suite's own mock may count or refuse calls). */
export function resetNativeChatSendClaimsForTests(options: { keepStored?: boolean } = {}): void {
  claims = new Map()
  hydration = options.keepStored ? null : Promise.resolve()
  readRefused = false
  writes = Promise.resolve()
}
