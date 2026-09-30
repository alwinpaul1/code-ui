import { describe, expect, it } from 'vitest'
import {
  TERMINAL_AUTO_RESTORE_FIT_UNREADABLE,
  claimTerminalAutoRestoreFitRead,
  isKnownTerminalAutoRestoreFit,
  readTerminalAutoRestoreFitReply,
  setTerminalAutoRestoreFitMsForHost,
  type TerminalAutoRestoreFitByHost,
  type TerminalAutoRestoreFitReadLedger
} from './terminal-auto-restore-fit-state'

const UNREADABLE = TERMINAL_AUTO_RESTORE_FIT_UNREADABLE

describe('terminal auto restore fit state', () => {
  it("reads the desktop's { ms } from inside the reply envelope", () => {
    expect(readTerminalAutoRestoreFitReply({ id: '1', ok: true, result: { ms: 60_000 } })).toBe(60_000)
    expect(readTerminalAutoRestoreFitReply({ id: '1', ok: true, result: { ms: null } })).toBeNull()
  })

  it('does not read a missing, refused or malformed answer as the default', () => {
    // The shape the screen used to read: `ms` on the envelope itself, where the desktop never puts it.
    expect(readTerminalAutoRestoreFitReply({ ms: 60_000 })).toBe(UNREADABLE)
    expect(readTerminalAutoRestoreFitReply({ id: '1', ok: true, result: {} })).toBe(UNREADABLE)
    expect(readTerminalAutoRestoreFitReply({ id: '1', ok: true, result: null })).toBe(UNREADABLE)
    expect(readTerminalAutoRestoreFitReply({ id: '1', ok: true })).toBe(UNREADABLE)
    expect(
      readTerminalAutoRestoreFitReply({
        id: '1',
        ok: false,
        error: { code: 'method_not_found', message: 'Unknown method' }
      })
    ).toBe(UNREADABLE)
    expect(readTerminalAutoRestoreFitReply(undefined)).toBe(UNREADABLE)
    expect(readTerminalAutoRestoreFitReply(null)).toBe(UNREADABLE)
    for (const ms of ['60000', 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(readTerminalAutoRestoreFitReply({ id: '1', ok: true, result: { ms } })).toBe(UNREADABLE)
    }
  })

  it('knows a value only once the desktop answered it', () => {
    expect(isKnownTerminalAutoRestoreFit(null)).toBe(true)
    expect(isKnownTerminalAutoRestoreFit(60_000)).toBe(true)
    expect(isKnownTerminalAutoRestoreFit(undefined)).toBe(false)
    expect(isKnownTerminalAutoRestoreFit(UNREADABLE)).toBe(false)
  })

  it('returns the existing state object when a host value is unchanged', () => {
    const current: TerminalAutoRestoreFitByHost = { hostA: 60_000, hostB: null, hostC: UNREADABLE }

    expect(setTerminalAutoRestoreFitMsForHost(current, 'hostA', 60_000)).toBe(current)
    expect(setTerminalAutoRestoreFitMsForHost(current, 'hostB', null)).toBe(current)
    expect(setTerminalAutoRestoreFitMsForHost(current, 'hostC', UNREADABLE)).toBe(current)
  })

  it('updates one host while preserving other host values', () => {
    const current = { hostA: 60_000, hostB: null }
    const next = setTerminalAutoRestoreFitMsForHost(current, 'hostA', 300_000)

    expect(next).not.toBe(current)
    expect(next).toEqual({ hostA: 300_000, hostB: null })
    expect(setTerminalAutoRestoreFitMsForHost(next, 'hostB', UNREADABLE)).toEqual({
      hostA: 300_000,
      hostB: UNREADABLE
    })
  })

  it('reads each desktop once per connection, and again on its next one', () => {
    const ledger: TerminalAutoRestoreFitReadLedger = new Map()

    expect(claimTerminalAutoRestoreFitRead(ledger, 'hostA', 1000)).toBe(true)
    expect(claimTerminalAutoRestoreFitRead(ledger, 'hostA', 1000)).toBe(false)
    expect(claimTerminalAutoRestoreFitRead(ledger, 'hostB', 1000)).toBe(true)
    expect(claimTerminalAutoRestoreFitRead(ledger, 'hostA', 2000)).toBe(true)
    expect(claimTerminalAutoRestoreFitRead(ledger, 'hostA', 2000)).toBe(false)
  })

  it('reads once, not on every tick, for a client that reports no connection time', () => {
    const ledger: TerminalAutoRestoreFitReadLedger = new Map()

    expect(claimTerminalAutoRestoreFitRead(ledger, 'hostA', null)).toBe(true)
    expect(claimTerminalAutoRestoreFitRead(ledger, 'hostA', null)).toBe(false)
    expect(claimTerminalAutoRestoreFitRead(ledger, 'hostA', 1000)).toBe(true)
  })
})
