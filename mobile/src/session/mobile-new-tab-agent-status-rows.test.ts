// Orca #27196: a workspace another Orca server owns says so in the create-tab drawer, rather than
// "Agent Presets Unavailable — Check the host connection", which no reconnect would ever fix.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { mobileNewTabAgentStatusRows } from './mobile-new-tab-agent-status-rows'

vi.mock('lucide-react-native', () => ({ Bot: 'Bot' }))

describe('the create-tab drawer row when no agent can be picked', () => {
  it('names another server for a workspace another runtime owns, disabled', () => {
    expect(mobileNewTabAgentStatusRows('other-runtime', 'Check the host connection')).toEqual([
      expect.objectContaining({
        label: 'Agents on Another Server',
        hint: 'Pair that server directly',
        disabled: true
      })
    ])
  })

  it('keeps the failed read and the none-enabled rows as they were', () => {
    expect(mobileNewTabAgentStatusRows('error', 'Copy notes instead')).toEqual([
      expect.objectContaining({ label: 'Agent Presets Unavailable', hint: 'Copy notes instead' })
    ])
    expect(mobileNewTabAgentStatusRows('loaded', 'x')).toEqual([
      expect.objectContaining({ label: 'No Enabled Agents' })
    ])
    expect(mobileNewTabAgentStatusRows('idle', 'x')).toEqual([])
  })

  // A structure check, not a behaviour one: the panel hook is a route hook with no harness, and the
  // defect was which rows it builds. Both lists must take their tail from the one helper.
  it('builds both the create-tab and the send-notes lists from it', () => {
    const source = readFileSync(new URL('./use-mobile-session-panel-route-actions.tsx', import.meta.url), 'utf8')
    const calls = source.match(/mobileNewTabAgentStatusRows\(createTabAgentLoadState, '[^']+'\)/g) ?? []
    expect(calls).toEqual([
      "mobileNewTabAgentStatusRows(createTabAgentLoadState, 'Check the host connection')",
      "mobileNewTabAgentStatusRows(createTabAgentLoadState, 'Copy notes instead')"
    ])
  })
})
