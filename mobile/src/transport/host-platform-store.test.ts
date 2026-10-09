import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { getHostPlatform, noteHostPlatform, resetHostPlatformsForTests } from './host-platform-store'

describe('the platform each host said it runs on', () => {
  afterEach(() => resetHostPlatformsForTests())

  it('is unknown until the host has said, and per host', () => {
    expect(getHostPlatform('h1')).toBeNull()
    noteHostPlatform('h1', 'win32')
    expect(getHostPlatform('h1')).toBe('win32')
    expect(getHostPlatform('h2')).toBeNull()
  })

  it('keeps what a host said through a later status that could not be read', () => {
    noteHostPlatform('h1', 'darwin')
    noteHostPlatform('h1', null)
    expect(getHostPlatform('h1')).toBe('darwin')
  })

  // The chat's model pill reads this store, not the probe: if the probe stops
  // filing what it read, a Windows tab silently waits out the settle again.
  it('is filled by the session screen capability probe, under the host it asked', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../session/use-mobile-session-tab-reconciliation.ts', import.meta.url)),
      'utf8'
    )
    const code = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(code).toMatch(/startRuntimeCapabilityProbe\(client, \(capabilities, statusResult\) => \{[^}]*noteHostPlatform\(hostId, hostPlatformRef\.current\)/)
  })
})
