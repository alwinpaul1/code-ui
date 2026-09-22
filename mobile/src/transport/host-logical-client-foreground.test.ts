import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('the host relay while the app is backgrounded', () => {
  it('stays on the foreground leash so reopening does not have to reconnect', () => {
    const source = readFileSync(new URL('./host-logical-client.ts', import.meta.url), 'utf8')
    const ui = source.slice(source.lastIndexOf('const endpointLifecycle'))
    expect(ui).toContain('endpointLifecycle.setForeground(true)')
    expect(ui).not.toContain("setForeground(state === 'active')")
  })
})
