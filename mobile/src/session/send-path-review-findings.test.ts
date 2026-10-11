// Findings of the Opus review of the send-path batch (2026-10-11), each pinned from the scenario
// it described before the fix.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { nativeChatOutboxEntries, resetNativeChatOutboxForTests } from '../storage/native-chat-outbox'
import {
  claimNonceForSend,
  claimRowForSend,
  hydrateNativeChatSendClaims,
  nativeChatSendClaimWritesSettled,
  nonceClaimant,
  resetNativeChatSendClaimsForTests,
  rowClaimant
} from '../storage/native-chat-send-claims'
import { findBeaconConfirmedSends } from './mobile-native-chat-beacon-confirm'
import { outboxEchoId } from './mobile-native-chat-outbox-drafts'
import type { MobileNativeChatPendingMessage, MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'
import { landedHeldSends, sendAlreadyOnRecord } from './mobile-native-chat-unconfirmed-hold'
import { outboxEntryLanding, planOutboxEntry, OUTBOX_IDLE_SETTLE_MS } from './native-chat-outbox-recovery-plan'
import { mountOutboxDrainer, patchOutboxEntry, publishOutboxChatRoute, recordOutboxSend, resetOutboxSendsForTests } from './native-chat-outbox-sends'
import { openSendGateOutbox } from './native-chat-send-gate-outbox'

const user = (id: string, text: string): NativeChatMessage => ({ id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' })
const DRAFT_KEY = 'h\0w\0t'

function origin(overrides: Partial<MobileNativeChatSendOrigin>): MobileNativeChatSendOrigin {
  return {
    draftKey: DRAFT_KEY,
    draftEditGeneration: 0,
    pendingKey: `${DRAFT_KEY}\0s`,
    normalizedText: 'yes',
    baselineOccurrences: 0,
    baselineTailMessageId: 't',
    baselineResolved: true,
    sentAt: 1,
    ...overrides
  }
}

beforeEach(() => {
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
})
afterEach(() => {
  resetNativeChatOutboxForTests()
  resetOutboxSendsForTests()
})

describe('finding 1: a bubble waiting in the outbox never took the desktop', () => {
  it('does not take the row of a later held send of the same words', async () => {
    // "yes" (A) ended "Not sent": its entry waits in the outbox, never written.
    recordOutboxSend(origin({ outboxId: 'A' }), 'yes')
    await patchOutboxEntry('A', { failed: true })
    resetOutboxSendsForTests() // a later run: nothing carries A now
    const bubbleA: MobileNativeChatPendingMessage = { id: outboxEchoId('A'), text: 'yes', expectedOccurrence: 1, baselineTailMessageId: 't', baselineResolved: true, sentAt: 1 }
    const heldB = { draftKey: DRAFT_KEY, pendingKey: null, text: 'yes', normalizedText: 'yes', baselineTailMessageId: 't', deadline: null, outboxId: 'B', sentAt: 2 }
    const landed = landedHeldSends([user('t', 'x'), user('r', 'yes')], [heldB], [bubbleA])
    expect(landed).toEqual([heldB])
    expect(rowClaimant('r')).toBe('B')
  })
})

describe('finding 2: a write that failed on a send whose boundary never settled', () => {
  it('is not called delivered by an older row of the same words', () => {
    expect(
      sendAlreadyOnRecord({
        origin: origin({ outboxId: 'S', normalizedText: 'continue', baselineTailMessageId: null, baselineResolved: false }),
        text: 'continue',
        messages: [user('old', 'continue')],
        isActiveTranscript: true
      })
    ).toBe(false)
  })
})

describe('finding 3: a send parked before anything was written, offline from launch', () => {
  it('is sent by the recovery once the link is back, though its boundary never settled', () => {
    unmountLater(mountOutboxDrainer())
    unmountLater(publishOutboxChatRoute(DRAFT_KEY, { hostId: 'h', worktreeId: 'w', tabId: 't', lane: 'terminal', agent: 'claude', sessionId: 's', terminal: 'term', transcriptPath: null }))
    const gate = openSendGateOutbox({
      origin: origin({ outboxId: 'P', normalizedText: 'deploy it', baselineTailMessageId: null, baselineResolved: false, sentAt: Date.now() }),
      draftText: 'deploy it',
      chat: true,
      syncComposer: true,
      report: () => {},
      clearDraftForSend: () => {}
    })
    gate.enter()
    expect(gate.refuse('Message not sent: not connected to your desktop', { ready: false, missing: 'connection', waitedMs: 11_000, reachability: null, neverConnected: true, late: false, away: false })).toBe('unknown')
    const [entry] = nativeChatOutboxEntries()
    const landing = outboxEntryLanding(entry!, [user('old', 'deploy it')], [])
    expect(landing).toBe('missing')
    expect(
      planOutboxEntry({ entry: entry!, lane: 'terminal', pendingKey: entry!.pendingKey, transcriptSettled: true, landing, now: Date.now(), sendable: true, idleForMs: OUTBOX_IDLE_SETTLE_MS, waitedMs: 0, userRetry: false })
    ).toEqual({ kind: 'send' })
  })
})

describe('finding 4: prompt receipt nonces repeat', () => {
  it('does not keep a receipt claim across a restart, so a new receipt with an old nonce is seen', async () => {
    claimNonceForSend('old', 'status:S:x:0')
    claimRowForSend('old', 'r1')
    await nativeChatSendClaimWritesSettled()
    resetNativeChatSendClaimsForTests({ keepStored: true })
    await hydrateNativeChatSendClaims()
    expect(rowClaimant('r1')).toBe('old')
    expect(nonceClaimant('status:S:x:0')).toBeUndefined()
    const fresh = { draftKey: DRAFT_KEY, pendingKey: null, text: 'ok', normalizedText: 'ok', baselineTailMessageId: null, deadline: null, outboxId: 'new' }
    expect(findBeaconConfirmedSends([{ nonce: 'status:S:x:0', text: 'ok' }], [fresh])).toEqual([fresh])
  })
})

describe('finding 8: tests do not inherit the previous test’s stored claims', () => {
  it('starts from no stored claims after a reset', async () => {
    claimRowForSend('earlier-test', 'u1')
    await nativeChatSendClaimWritesSettled()
    resetNativeChatSendClaimsForTests()
    await hydrateNativeChatSendClaims()
    expect(rowClaimant('u1')).toBeUndefined()
    // The next claim writes only what this test holds.
    claimRowForSend('this-test', 'u2')
    await nativeChatSendClaimWritesSettled()
    expect(JSON.parse((await AsyncStorage.getItem('orca:chatSendClaims')) ?? '[]').map((claim: { key: string }) => claim.key)).toEqual(['u2'])
  })
})

const unmounts: Array<() => void> = []
function unmountLater(unmount: () => void): void {
  unmounts.push(unmount)
}
afterEach(() => {
  for (const unmount of unmounts.splice(0)) {
    unmount()
  }
})
