// Since 0.9.127 every composer send wrote a `chat-send-timing` line to its host's connection log
// (Settings → Connection log), which keeps 200 entries per host and is saved whole on each
// append. So about 200 ordinary sends pushed out the connection events that screen exists for
// (drops, revivals, pairing), and every send cost a full log save. A fast send that the desktop
// took is nothing to read back: only a slow one (over NATIVE_CHAT_SLOW_SEND_MS) or one that was
// not sent or not confirmed leaves a line.
//
// Drives the REAL connection-log store (its 200-entry cap and its save) through the REAL timing
// module, with the timings the send stages report.

import AsyncStorage from '@react-native-async-storage/async-storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectionLogStore } from '../transport/persisted-connection-log-store'
import type { ConnectionLogEntry } from '../transport/types'
import {
  beginNativeChatSendTiming,
  finishNativeChatSendTiming,
  noteSendOutcome,
  noteSendStage,
  resetNativeChatSendTimingForTests
} from './native-chat-send-timing'

// A host per case: the store is module state, and a case must not start at its cap.
let HOST = 'host-budget'
const scope = (): string => `${HOST}\0w\0tab-3`
let hosts = 0

function connectionEvent(i: number): ConnectionLogEntry {
  return { id: `drop-${i}`, ts: i, level: 'warn', code: 'app-paused', message: `Link dropped ${i}` }
}

function send(totalMs: number, outcome: string, stages: [Parameters<typeof noteSendStage>[0], number][], startedAt: number): void {
  const timing = beginNativeChatSendTiming(scope(), { chars: 12 }, startedAt)
  for (const [stage, ms] of stages) {
    noteSendStage(stage, ms)
  }
  noteSendOutcome(outcome)
  finishNativeChatSendTiming(timing, outcome, startedAt + totalMs)
}

describe('what a send writes to the connection log', () => {
  beforeEach(async () => {
    resetNativeChatSendTimingForTests()
    hosts += 1
    HOST = `host-budget-${hosts}`
    await connectionLogStore.hydrate(HOST)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the connection events after 300 fast sends, and writes no line or save for them', async () => {
    for (let i = 0; i < 20; i += 1) {
      connectionLogStore.append(HOST, connectionEvent(i))
    }
    const save = vi.spyOn(AsyncStorage, 'setItem')
    for (let i = 0; i < 300; i += 1) {
      send(400, 'accepted', [['readiness', 20], ['write', 300]], 1_000_000 + i * 1_000)
    }

    const entries = connectionLogStore.get(HOST)
    expect(entries.filter((entry) => entry.code === 'chat-send-timing')).toEqual([])
    expect(entries.filter((entry) => entry.code === 'app-paused').map((entry) => entry.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `drop-${i}`)
    )
    expect(save.mock.calls.filter(([key]) => String(key).startsWith('orca.mobile.connection-log'))).toEqual([])
  })

  it('still writes one warning naming the stage that held a slow send, without its words', () => {
    send(4_200, 'accepted', [['readiness', 3_600], ['write', 400]], 2_000_000)

    const lines = connectionLogStore.get(HOST)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.code).toBe('chat-send-timing')
    expect(lines[0]!.level).toBe('warn')
    expect(lines[0]!.detail).toMatch(/^total 4200 ms \(slow: readiness 3600 ms\)/)
    expect(lines[0]!.detail).toContain('12 chars')
  })

  it('still writes a line for a fast send that was not sent, and for one held unconfirmed', () => {
    send(300, 'rejected', [['write', 200]], 3_000_000)
    send(300, 'unknown', [['write', 200]], 3_100_000)

    const lines = connectionLogStore.get(HOST)
    expect(lines.map((line) => line.message)).toEqual(['Message not sent', 'Message held until the desktop shows it'])
  })
})
