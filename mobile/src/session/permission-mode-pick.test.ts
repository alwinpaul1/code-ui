/**
 * Parity audit 2026-10-15, gap 3: the Select mode sheet pressed Shift+Tab into the desktop
 * terminal, which needs the relay, so with the relay down a mode pick did nothing while the Claude
 * app on the same session sets it with `set_permission_mode`. A matched tab with a live Anthropic
 * link now sets it there and presses nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import { pickPermissionMode } from './permission-mode-pick'

describe('a pick in the Select mode sheet', () => {
  it('sets the mode through Anthropic and presses no Shift+Tab when the tab’s link is live', async () => {
    const viaAnthropic = vi.fn(async () => null)
    const stepTerminal = vi.fn(async () => true)
    const said: string[] = []
    await pickPermissionMode({ mode: 'acceptEdits', viaAnthropic, stepTerminal, say: (message) => said.push(message) })
    expect(viaAnthropic).toHaveBeenCalledWith('acceptEdits')
    expect(stepTerminal).not.toHaveBeenCalled()
    expect(said).toEqual([])
  })

  it('says the app’s words once when the session refused the mode', async () => {
    const said: string[] = []
    await pickPermissionMode({ mode: 'bypassPermissions', viaAnthropic: async () => 'That mode isn’t available right now', stepTerminal: async () => true, say: (message) => said.push(message) })
    expect(said).toEqual(['That mode isn’t available right now'])
  })

  it('steps the terminal as before when there is no live link', async () => {
    const stepTerminal = vi.fn(async () => false)
    const said: string[] = []
    await pickPermissionMode({ mode: 'plan', viaAnthropic: undefined, stepTerminal, say: (message) => said.push(message) })
    expect(stepTerminal).toHaveBeenCalledWith('plan')
    expect(said).toEqual(['That mode is not available in this session'])
  })
})
