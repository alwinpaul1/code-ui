// What the app-wide outbox drainer does with one entry, and which entries it may take. The user,
// 2026-10-11: "All messages must be send reliability and must not drop". Pure: no clock, no host.

import { describe, expect, it } from 'vitest'
import type { NativeChatOutboxEntry } from '../storage/native-chat-outbox'
import {
  OUTBOX_DRAIN_BACKOFF_MS,
  OUTBOX_DRAIN_SESSION_ATTEMPTS,
  OUTBOX_DRAIN_TERMINAL_ATTEMPTS,
  OUTBOX_TERMINAL_CONFIRM_WAIT_MS,
  outboxDrainBackoffMs,
  outboxDrainCandidates,
  outboxTerminalConfirmedAt,
  planOutboxDrain
} from './native-chat-outbox-drain-plan'
import { OUTBOX_MAX_RESEND_AGE_MS } from './native-chat-outbox-recovery-plan'

const NOW = 1_800_000_000_000

function entry(overrides: Partial<NativeChatOutboxEntry> = {}): NativeChatOutboxEntry {
  return {
    id: 'send-1',
    draftKey: 'h\0w\0tab-a',
    pendingKey: 'h\0w\0tab-a\0session-1',
    text: 'run the tests',
    normalizedText: 'run the tests',
    baselineOccurrences: 0,
    baselineTailMessageId: 'a-1',
    baselineResolved: true,
    createdAt: NOW - 60_000,
    operationId: 'op-1',
    autoAttempts: 0,
    route: {
      hostId: 'h',
      worktreeId: 'w',
      tabId: 'tab-a',
      lane: 'terminal',
      agent: 'claude',
      sessionId: 'session-1',
      terminal: 'term-1',
      transcriptPath: null
    },
    ...overrides
  }
}

const session = (overrides: Partial<NativeChatOutboxEntry> = {}): NativeChatOutboxEntry =>
  entry({ route: { ...entry().route!, lane: 'session', terminal: null }, ...overrides })

describe('planOutboxDrain', () => {
  it('retires an entry that arrived, even one over a day old, and sends nothing', () => {
    expect(planOutboxDrain(entry(), { kind: 'landed' }, NOW)).toEqual({ kind: 'retire' })
    expect(planOutboxDrain(entry({ createdAt: NOW - OUTBOX_MAX_RESEND_AGE_MS - 1 }), { kind: 'landed' }, NOW)).toEqual({
      kind: 'retire'
    })
  })

  it('sends an entry that did not arrive when it is safe to', () => {
    expect(planOutboxDrain(entry(), { kind: 'clear', terminal: 'term-1' }, NOW)).toEqual({ kind: 'send' })
    expect(planOutboxDrain(session(), { kind: 'clear' }, NOW)).toEqual({ kind: 'send' })
  })

  it('waits, without giving up, while the agent is busy', () => {
    expect(planOutboxDrain(entry(), { kind: 'busy' }, NOW)).toEqual({ kind: 'wait' })
  })

  it('keeps the message and says why when it cannot be sent', () => {
    expect(planOutboxDrain(entry(), { kind: 'tab-gone' }, NOW)).toEqual({ kind: 'fail', reason: 'tabClosed' })
    expect(planOutboxDrain(entry(), { kind: 'session-changed' }, NOW)).toEqual({ kind: 'fail', reason: 'session' })
    expect(planOutboxDrain(entry(), { kind: 'unsure' }, NOW)).toEqual({ kind: 'fail', reason: 'unsure' })
    expect(planOutboxDrain(entry({ createdAt: NOW - OUTBOX_MAX_RESEND_AGE_MS - 1 }), { kind: 'clear' }, NOW)).toEqual({
      kind: 'fail',
      reason: 'tooOld'
    })
  })

  it('gives a terminal entry only a few typed retries and a structured one more, under its one id', () => {
    expect(OUTBOX_DRAIN_SESSION_ATTEMPTS).toBeGreaterThan(OUTBOX_DRAIN_TERMINAL_ATTEMPTS)
    const clear = { kind: 'clear' } as const
    expect(planOutboxDrain(entry({ autoAttempts: OUTBOX_DRAIN_TERMINAL_ATTEMPTS - 1 }), clear, NOW)).toEqual({ kind: 'send' })
    expect(planOutboxDrain(entry({ autoAttempts: OUTBOX_DRAIN_TERMINAL_ATTEMPTS }), clear, NOW)).toEqual({
      kind: 'fail',
      reason: 'attempts'
    })
    expect(planOutboxDrain(session({ autoAttempts: OUTBOX_DRAIN_TERMINAL_ATTEMPTS }), clear, NOW)).toEqual({ kind: 'send' })
    expect(planOutboxDrain(session({ autoAttempts: OUTBOX_DRAIN_SESSION_ATTEMPTS }), clear, NOW)).toEqual({
      kind: 'fail',
      reason: 'attempts'
    })
  })
})

describe('outboxDrainBackoffMs', () => {
  it('grows, then holds at its last step', () => {
    expect(outboxDrainBackoffMs(0)).toBe(OUTBOX_DRAIN_BACKOFF_MS[0])
    expect(outboxDrainBackoffMs(1)).toBe(OUTBOX_DRAIN_BACKOFF_MS[0])
    expect(outboxDrainBackoffMs(2)).toBe(OUTBOX_DRAIN_BACKOFF_MS[1])
    expect(outboxDrainBackoffMs(OUTBOX_DRAIN_BACKOFF_MS.length)).toBe(OUTBOX_DRAIN_BACKOFF_MS.at(-1))
    expect(outboxDrainBackoffMs(99)).toBe(OUTBOX_DRAIN_BACKOFF_MS.at(-1))
  })
})

describe('outboxTerminalConfirmedAt', () => {
  it('runs the confirm wait from the last send, or from the press', () => {
    expect(outboxTerminalConfirmedAt(entry())).toBe(NOW - 60_000 + OUTBOX_TERMINAL_CONFIRM_WAIT_MS)
    expect(outboxTerminalConfirmedAt(entry({ lastAttemptAt: NOW }))).toBe(NOW + OUTBOX_TERMINAL_CONFIRM_WAIT_MS)
  })
})

describe('outboxDrainCandidates', () => {
  const can = {
    live: () => false,
    drainable: (item: NativeChatOutboxEntry) => item.route !== undefined,
    ownedByChat: () => false
  }

  it('takes nothing from an empty outbox', () => {
    expect(outboxDrainCandidates([], can)).toEqual([])
  })

  it('takes the one entry there is', () => {
    expect(outboxDrainCandidates([entry()], can).map((item) => item.id)).toEqual(['send-1'])
  })

  it('takes one entry per chat, the oldest, so messages of one chat go in the order they were sent', () => {
    const older = entry({ id: 'older', createdAt: NOW - 90_000 })
    const newer = entry({ id: 'newer', createdAt: NOW - 30_000 })
    const other = entry({ id: 'other', draftKey: 'h\0w\0tab-b', createdAt: NOW - 10_000 })
    expect(outboxDrainCandidates([newer, other, older], can).map((item) => item.id)).toEqual(['older', 'other'])
  })

  it('holds a chat back while its oldest message is carried by a send or by the chat on screen', () => {
    const older = entry({ id: 'older', createdAt: NOW - 90_000 })
    const newer = entry({ id: 'newer', createdAt: NOW - 30_000 })
    expect(outboxDrainCandidates([older, newer], { ...can, live: (item) => item.id === 'older' })).toEqual([])
    expect(outboxDrainCandidates([older, newer], { ...can, ownedByChat: (item) => item.id === 'older' })).toEqual([])
  })

  it('does not let a failed entry, or one an older build wrote, hold the rest of its chat', () => {
    const failed = entry({ id: 'failed', createdAt: NOW - 90_000, failed: true })
    const legacy = entry({ id: 'legacy', createdAt: NOW - 60_000, route: undefined })
    const next = entry({ id: 'next', createdAt: NOW - 30_000 })
    expect(outboxDrainCandidates([failed, legacy, next], can).map((item) => item.id)).toEqual(['next'])
  })
})
