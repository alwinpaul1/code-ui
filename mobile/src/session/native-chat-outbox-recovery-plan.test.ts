// What the outbox recovery does with one message the app was closed under (2026-10-10): the
// boundaries of each rule, where an off-by-one would send a message twice or lose it.

import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import {
  OUTBOX_IDLE_SETTLE_MS,
  OUTBOX_MAX_RESEND_AGE_MS,
  OUTBOX_SAFE_WAIT_MS,
  outboxEntryLanding,
  planOutboxEntry
} from './native-chat-outbox-recovery-plan'

const TEXT = 'deploy it'
const NOW = 1_800_000_000_000

function entry(overrides: Partial<NativeChatOutboxEntry> = {}): NativeChatOutboxEntry {
  return {
    id: 'send-1',
    draftKey: 'h\0w\0t',
    pendingKey: 'h\0w\0t\0s',
    text: TEXT,
    normalizedText: TEXT,
    baselineOccurrences: 0,
    baselineTailMessageId: null,
    baselineResolved: true,
    createdAt: NOW - 60_000,
    operationId: `${NOW}-${'b'.repeat(32)}`,
    autoAttempts: 0,
    ...overrides
  }
}

function user(id: string, text: string): NativeChatMessage {
  return { id, role: 'user', blocks: [{ type: 'text', text }], timestamp: null, source: 'transcript' }
}

const plan = (overrides: Partial<Parameters<typeof planOutboxEntry>[0]> = {}) =>
  planOutboxEntry({
    entry: entry(),
    lane: 'terminal',
    pendingKey: 'h\0w\0t\0s',
    transcriptSettled: true,
    landing: 'missing',
    now: NOW,
    sendable: true,
    idleForMs: OUTBOX_IDLE_SETTLE_MS,
    waitedMs: 0,
    userRetry: false,
    ...overrides
  })

describe('whether a message the app was closed under landed', () => {
  it('reads an empty conversation with no boundary as missing, and its own row after the boundary as landed', () => {
    expect(outboxEntryLanding(entry(), [], [])).toBe('missing')
    expect(outboxEntryLanding(entry(), [user('u1', TEXT)], [])).toBe('landed')
  })

  it('does not count a row of the same words written before it left', () => {
    const before = [user('u0', TEXT)]
    expect(outboxEntryLanding(entry({ baselineTailMessageId: 'u0' }), before, [])).toBe('missing')
    expect(outboxEntryLanding(entry({ baselineTailMessageId: 'u0' }), [...before, user('u1', TEXT)], [])).toBe('landed')
  })

  it('is unsure when its boundary is not in what was read, or was never a settled read', () => {
    expect(outboxEntryLanding(entry({ baselineTailMessageId: 'gone' }), [user('u5', 'other')], [])).toBe('unsure')
    expect(outboxEntryLanding(entry({ baselineResolved: false }), [], [])).toBe('unsure')
  })

  it('counts the agent prompt receipt (a mid-turn prompt writes no row), but not one it had before', () => {
    expect(outboxEntryLanding(entry(), [], [{ nonce: 'n2', text: TEXT }])).toBe('landed')
    expect(outboxEntryLanding(entry({ knownReceiptNonces: ['n2'] }), [], [{ nonce: 'n2', text: TEXT }])).toBe('missing')
  })
})

describe('what the recovery does with it', () => {
  it('waits for a settled read, retires a landed one, and gives one for another session back', () => {
    expect(plan({ transcriptSettled: false })).toEqual({ kind: 'wait' })
    expect(plan({ landing: 'landed' })).toEqual({ kind: 'retire' })
    expect(plan({ pendingKey: 'h\0w\0t\0other' })).toEqual({ kind: 'give-back', reason: 'session' })
  })

  it('sends one exactly a day old and gives back one a moment older', () => {
    expect(plan({ entry: entry({ createdAt: NOW - OUTBOX_MAX_RESEND_AGE_MS }) })).toEqual({ kind: 'send' })
    expect(plan({ entry: entry({ createdAt: NOW - OUTBOX_MAX_RESEND_AGE_MS - 1 }) })).toEqual({
      kind: 'give-back',
      reason: 'tooOld'
    })
  })

  it('types into a terminal only once the agent has been safe to type into for the whole settle', () => {
    expect(plan({ idleForMs: null })).toEqual({ kind: 'wait' })
    expect(plan({ idleForMs: OUTBOX_IDLE_SETTLE_MS - 1 })).toEqual({ kind: 'wait' })
    expect(plan({ idleForMs: OUTBOX_IDLE_SETTLE_MS })).toEqual({ kind: 'send' })
    expect(plan({ sendable: false })).toEqual({ kind: 'wait' })
  })

  it('gives a terminal one back after the safe wait, to the millisecond', () => {
    expect(plan({ idleForMs: null, waitedMs: OUTBOX_SAFE_WAIT_MS - 1 })).toEqual({ kind: 'wait' })
    expect(plan({ idleForMs: null, waitedMs: OUTBOX_SAFE_WAIT_MS })).toEqual({ kind: 'give-back', reason: 'busy' })
  })

  it('never types a terminal one by itself after one automatic attempt, or when unsure; Retry still can', () => {
    expect(plan({ entry: entry({ autoAttempts: 1 }) })).toEqual({ kind: 'fail' })
    expect(plan({ landing: 'unsure' })).toEqual({ kind: 'fail' })
    expect(plan({ entry: entry({ autoAttempts: 1, failed: true }) })).toEqual({ kind: 'wait' })
    expect(plan({ entry: entry({ autoAttempts: 1, failed: true }), userRetry: true })).toEqual({ kind: 'send' })
  })

  it('resends a structured one under its id even when unsure, up to two automatic attempts', () => {
    expect(plan({ lane: 'session', landing: 'unsure', idleForMs: null })).toEqual({ kind: 'send' })
    expect(plan({ lane: 'session', entry: entry({ autoAttempts: 1 }) })).toEqual({ kind: 'send' })
    expect(plan({ lane: 'session', entry: entry({ autoAttempts: 2 }) })).toEqual({ kind: 'fail' })
  })

  it('gives back one that carried files rather than sending its words alone', () => {
    expect(plan({ entry: entry({ hasAttachments: true }) })).toEqual({ kind: 'give-back', reason: 'attachments' })
  })
})
