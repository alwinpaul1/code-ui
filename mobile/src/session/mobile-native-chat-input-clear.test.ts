// Verified against Claude Code 2.1.266 in a 60-column tmux pane (2026-09-09):
// one Ctrl+U on a wrapped input removed only the LAST visual line, and a burst of
// 17 Ctrl+U + 17 Ctrl+K emptied a six-visual-line input in one write.
import { describe, expect, it } from 'vitest'
import {
  AGENT_TUI_CLEAR_INPUT_FORWARD,
  AGENT_TUI_CLEAR_INPUT_LINE,
  AGENT_TUI_CLEAR_MAX_LINES
} from '../../../src/shared/agent-tui-input-clear'
import {
  buildMobileNativeChatClearInputForText,
  buildMobileNativeChatClearInputOneRead,
  buildScreenSizedClearInput,
  MOBILE_NATIVE_CHAT_CLEAR_MAX_ROWS,
  MOBILE_NATIVE_CHAT_SCREEN_CLEAR_SLACK
} from './mobile-native-chat-input-clear'

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
    expect(count(burst, AGENT_TUI_CLEAR_INPUT_FORWARD)).toBe(
      count(burst, AGENT_TUI_CLEAR_INPUT_LINE)
    )
  })

  it('never sends a single Ctrl+U, even for a short draft', () => {
    // The mirrored line can hold more than the draft (desktop typing, an earlier
    // visit's residue), and one Ctrl+U reaches one visual line of it.
    expect(buildMobileNativeChatClearInputForText('hello')).not.toBe(AGENT_TUI_CLEAR_INPUT_LINE)
    expect(
      count(buildMobileNativeChatClearInputForText('hello'), AGENT_TUI_CLEAR_INPUT_LINE)
    ).toBeGreaterThan(1)
  })

  it('counts wrapped visual lines per logical line and still caps the burst', () => {
    const twoLogical = `${WRAPPED}\n${WRAPPED}`
    expect(
      count(buildMobileNativeChatClearInputForText(twoLogical), AGENT_TUI_CLEAR_INPUT_LINE)
    ).toBeGreaterThan(
      count(buildMobileNativeChatClearInputForText(WRAPPED), AGENT_TUI_CLEAR_INPUT_LINE)
    )
    const huge = WRAPPED.repeat(40)
    expect(count(buildMobileNativeChatClearInputForText(huge), AGENT_TUI_CLEAR_INPUT_LINE)).toBe(
      2 * AGENT_TUI_CLEAR_MAX_LINES - 1
    )
  })
})

// Claude Code 2.1.286 and 2.1.287 read a control byte as a key only when the
// whole stdin READ is under 64 bytes (`a.length<64||u===WZ.BS`, from the binary).
// The limit is per read, so a clear is ONE write under 64 bytes.
describe('the clear sized from the rows the screen shows', () => {
  it('sends nothing for no rows', () => {
    expect(buildScreenSizedClearInput(0)).toBe('')
    expect(buildScreenSizedClearInput(-3)).toBe('')
    expect(buildScreenSizedClearInput(Number.NaN)).toBe('')
  })

  it('clears one row with a small burst, still more than a single Ctrl+U', () => {
    const burst = buildScreenSizedClearInput(1)
    expect(count(burst, AGENT_TUI_CLEAR_INPUT_LINE)).toBe(
      2 * (1 + MOBILE_NATIVE_CHAT_SCREEN_CLEAR_SLACK) - 1
    )
    expect(count(burst, AGENT_TUI_CLEAR_INPUT_FORWARD)).toBe(
      count(burst, AGENT_TUI_CLEAR_INPUT_LINE)
    )
  })

  it("sizes the report's 176-character input by the rows the screen shows, not by the 20-column guess", () => {
    // 176 characters on a 190-column screen is one row. The text-sized burst
    // for it was 9 rows + 8 slack: 66 bytes, over the limit.
    expect(buildMobileNativeChatClearInputForText('x'.repeat(176)).length).toBe(66)
    expect(buildScreenSizedClearInput(1).length).toBeLessThan(20)
  })

  it('stays under 64 bytes for every row count, however tall the input', () => {
    for (const rows of [1, 2, 9, 14, 15, 16, 17, 40, 41, 1000, 1e9]) {
      expect(buildScreenSizedClearInput(rows).length).toBeLessThan(64)
    }
    expect(buildScreenSizedClearInput(1e9).length).toBe(62)
  })

  it('covers 14 rows in one write and stops growing past it', () => {
    expect(
      buildScreenSizedClearInput(
        MOBILE_NATIVE_CHAT_CLEAR_MAX_ROWS - MOBILE_NATIVE_CHAT_SCREEN_CLEAR_SLACK
      )
    ).toBe(buildScreenSizedClearInput(500))
    expect(buildScreenSizedClearInput(13).length).toBeLessThan(
      buildScreenSizedClearInput(14).length
    )
  })
})

describe('the text-sized clear held to one read, for a screen that cannot be read', () => {
  it('is the same burst while it fits', () => {
    expect(buildMobileNativeChatClearInputOneRead('hello')).toBe(
      buildMobileNativeChatClearInputForText('hello')
    )
  })

  it('is one write under 64 bytes where the text-sized burst is 66 or more', () => {
    for (const text of [WRAPPED, 'x'.repeat(176), 'long '.repeat(5000), `${WRAPPED}\n${WRAPPED}`]) {
      expect(buildMobileNativeChatClearInputForText(text).length).toBeGreaterThanOrEqual(64)
      expect(buildMobileNativeChatClearInputOneRead(text).length).toBeLessThan(64)
    }
  })

  it('handles no text and no candidates', () => {
    expect(buildMobileNativeChatClearInputOneRead()).toBe(buildMobileNativeChatClearInputForText())
    expect(buildMobileNativeChatClearInputOneRead(null, undefined, '')).toBe(
      buildMobileNativeChatClearInputForText(null, undefined, '')
    )
  })
})
