import { describe, expect, it } from 'vitest'
import type { HostCatalogEntry, HostCredentialStatus, HostProfile } from '../transport/types'
import { troubleshootHostTarget, troubleshootPairedHostsCheck } from './troubleshoot-paired-hosts'

/**
 * The "Paired hosts" row and the per-desktop rows, from the catalog. loadHosts() drops a host
 * whose Keychain read throws, so a phone whose only desktop was Keychain-locked was told "None —
 * scan a QR to pair" and the desktop vanished from the rows (review, 2026-09-30).
 */

const profile = (id: string): HostProfile => ({
  id,
  name: `Desk ${id}`,
  endpoint: 'ws://192.168.1.10:6768',
  deviceToken: `token-${id}`,
  publicKeyB64: 'key',
  lastConnected: 0
})
const entry = (id: string, credentialStatus: HostCredentialStatus): HostCatalogEntry => {
  const { deviceToken: _token, ...rest } = profile(id)
  return { ...rest, credentialStatus, profile: credentialStatus === 'ready' ? profile(id) : null }
}
const statuses = (...list: HostCredentialStatus[]) =>
  list.map((status) => ({ credentialStatus: status }))

describe('the Paired hosts row', () => {
  it('fails with "None" for an empty catalog, and only then', () => {
    expect(troubleshootPairedHostsCheck([])).toEqual({
      label: 'Paired hosts',
      status: 'fail',
      detail: 'None — scan a QR to pair'
    })
  })

  it('passes with the count when every desktop reads, one or several', () => {
    expect(troubleshootPairedHostsCheck(statuses('ready'))).toMatchObject({
      status: 'pass',
      detail: '1 paired'
    })
    expect(troubleshootPairedHostsCheck(statuses('ready', 'ready', 'ready'))).toMatchObject({
      status: 'pass',
      detail: '3 paired'
    })
  })

  it('does not tell a phone whose only desktop is Keychain-locked to scan a QR to pair', () => {
    expect(troubleshootPairedHostsCheck(statuses('temporarily-unavailable'))).toEqual({
      label: 'Paired hosts',
      status: 'warn',
      detail: "1 paired, 1 can't be read right now"
    })
  })

  it('names the unreadable and the credential-less apart, with the count agreeing', () => {
    expect(
      troubleshootPairedHostsCheck(
        statuses('ready', 'temporarily-unavailable', 'temporarily-unavailable', 'missing')
      )
    ).toMatchObject({
      status: 'warn',
      detail: "4 paired, 2 can't be read right now, 1 needs pairing again"
    })
    expect(troubleshootPairedHostsCheck(statuses('missing', 'missing'))).toMatchObject({
      detail: '2 paired, 2 need pairing again'
    })
  })
})

describe('a desktop in the reachability rows', () => {
  it('is probed when its credential reads', () => {
    expect(troubleshootHostTarget(entry('a', 'ready'))).toEqual({
      kind: 'probe',
      host: profile('a')
    })
  })

  it('gets a row that says it cannot be read right now instead of vanishing', () => {
    expect(troubleshootHostTarget(entry('a', 'temporarily-unavailable'))).toEqual({
      kind: 'check',
      check: {
        label: 'Desk a',
        status: 'warn',
        detail: "Not tested: it can't be read right now. Run again in a moment."
      }
    })
  })

  it('gets a failing row that says it needs pairing again when it has no credential', () => {
    expect(troubleshootHostTarget(entry('a', 'missing'))).toEqual({
      kind: 'check',
      check: {
        label: 'Desk a',
        status: 'fail',
        detail: 'Not tested: it needs pairing again. Scan its code from the home screen.'
      }
    })
  })
})
