import { describe, expect, it } from 'vitest'
import {
  AGENT_TUI_MAX_KEY_WRITE_BYTES,
  splitAgentTuiClearWrites
} from './agent-tui-clear-write-chunks'
import { buildMobileNativeChatClearInputForText } from './mobile-native-chat-input-clear'

describe('clearing an agent input that holds a long draft', () => {
  it('never asks the agent to read a paste-sized chunk of control keys at once', () => {
    // Measured against a live Claude Code 2.1.266 at 60 columns on 2026-09-10.
    // One write of 63 Ctrl+U cleared the composer; 64 did nothing at all, and
    // on the phone those bytes landed inside the submitted message: the
    // transcript received the text, then 37 literal kill-line bytes and 37
    // literal kill-to-end bytes, then the text again.
    const draft = 'When i open the codeui app'.repeat(16)
    const clearInput = buildMobileNativeChatClearInputForText(draft)
    expect(clearInput.length).toBeGreaterThanOrEqual(AGENT_TUI_MAX_KEY_WRITE_BYTES)

    const writes = splitAgentTuiClearWrites(clearInput)
    expect(writes.length).toBeGreaterThan(1)
    for (const write of writes) {
      expect(write.length).toBeLessThan(AGENT_TUI_MAX_KEY_WRITE_BYTES)
    }
    expect(writes.join('')).toBe(clearInput)
  })

  it('keeps a short clear as a single write, so the common send costs one round trip', () => {
    const clearInput = buildMobileNativeChatClearInputForText('a short draft')
    expect(clearInput.length).toBeLessThan(AGENT_TUI_MAX_KEY_WRITE_BYTES)
    expect(splitAgentTuiClearWrites(clearInput)).toEqual([clearInput])
  })

  it('sends nothing when there is nothing to clear', () => {
    expect(splitAgentTuiClearWrites('')).toEqual([])
  })

  it('stays under the bound for every burst the builder can produce', () => {
    for (const length of [1, 40, 200, 1000, 5000]) {
      const clearInput = buildMobileNativeChatClearInputForText('x'.repeat(length))
      const writes = splitAgentTuiClearWrites(clearInput)
      expect(writes.join('')).toBe(clearInput)
      for (const write of writes) {
        expect(write.length).toBeLessThan(AGENT_TUI_MAX_KEY_WRITE_BYTES)
      }
    }
  })
})
