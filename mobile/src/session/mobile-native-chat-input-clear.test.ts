// Verified against Claude Code 2.1.266 in a 60-column tmux pane (2026-09-09):
// one Ctrl+U on a wrapped input removed only the LAST visual line, and a burst of
// 17 Ctrl+U + 17 Ctrl+K emptied a six-visual-line input in one write.
import { describe, expect, it } from 'vitest'
import {
  AGENT_TUI_CLEAR_INPUT_FORWARD,
  AGENT_TUI_CLEAR_INPUT_LINE,
  AGENT_TUI_CLEAR_MAX_LINES
} from '../../../src/shared/agent-tui-input-clear'
import { buildMobileNativeChatClearInputForText } from './mobile-native-chat-input-clear'

const count = (burst: string, byte: string): number => burst.split(byte).length - 1

// The message that glued onto its own residue on the S23: one logical line,
// four visual lines at the phone terminal's width.
const WRAPPED =
  'Ok now review my paper each section with opus and Sonnet 5 agents and fable as main orchestator and final reviewer go through each section with each agent use /unslop skill to write'

describe('mobile native chat clear burst', () => {
  it('clears every visual line of a long single-line draft, not just the last one', () => {
    const burst = buildMobileNativeChatClearInputForText(WRAPPED)
    // 179 chars is nine visual lines at the narrowest terminal the phone will
    // measure (20 columns); plus the slack for text typed on the desktop itself.
    expect(count(burst, AGENT_TUI_CLEAR_INPUT_LINE)).toBeGreaterThanOrEqual(2 * (9 + 8) - 1)
    expect(count(burst, AGENT_TUI_CLEAR_INPUT_FORWARD)).toBe(count(burst, AGENT_TUI_CLEAR_INPUT_LINE))
  })

  it('never sends a single Ctrl+U, even for a short draft', () => {
    // The mirrored line can hold more than the draft (desktop typing, an earlier
    // visit's residue), and one Ctrl+U reaches one visual line of it.
    expect(buildMobileNativeChatClearInputForText('hello')).not.toBe(AGENT_TUI_CLEAR_INPUT_LINE)
    expect(count(buildMobileNativeChatClearInputForText('hello'), AGENT_TUI_CLEAR_INPUT_LINE)).toBeGreaterThan(1)
  })

  it('counts wrapped visual lines per logical line and still caps the burst', () => {
    const twoLogical = `${WRAPPED}\n${WRAPPED}`
    expect(count(buildMobileNativeChatClearInputForText(twoLogical), AGENT_TUI_CLEAR_INPUT_LINE)).toBeGreaterThan(
      count(buildMobileNativeChatClearInputForText(WRAPPED), AGENT_TUI_CLEAR_INPUT_LINE)
    )
    const huge = WRAPPED.repeat(40)
    expect(count(buildMobileNativeChatClearInputForText(huge), AGENT_TUI_CLEAR_INPUT_LINE)).toBe(
      2 * AGENT_TUI_CLEAR_MAX_LINES - 1
    )
  })
})
