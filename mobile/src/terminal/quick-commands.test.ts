import { describe, expect, it } from 'vitest'
import type { TerminalQuickCommand } from '../../../src/shared/terminal-quick-command-types'
import {
  buildMobileQuickCommandLaunch,
  getQuickCommandDisplayPreview,
  getQuickCommandPreview,
  supportsMobileQuickCommands
} from './quick-commands'

function command(overrides: Partial<TerminalQuickCommand> = {}): TerminalQuickCommand {
  return {
    id: 'command',
    label: 'Command',
    action: 'terminal-command',
    command: 'pnpm test',
    appendEnter: true,
    scope: { type: 'global' },
    ...overrides
  } as TerminalQuickCommand
}

describe('mobile quick-command launch', () => {
  it('only exposes quick commands when the host advertises the complete contract', () => {
    expect(supportsMobileQuickCommands(undefined)).toBe(false)
    expect(supportsMobileQuickCommands([])).toBe(false)
    expect(supportsMobileQuickCommands(['terminal.binary-stream.v1'])).toBe(false)
    expect(supportsMobileQuickCommands(['terminal.quick-commands.v1'])).toBe(true)
  })

  it('joins multiline runnable commands with "; " to match desktop', () => {
    // Parity with desktop flattenTerminalQuickCommand: the same saved command
    // must run identically on desktop and mobile.
    expect(
      buildMobileQuickCommandLaunch(command({ command: 'cd app\nnpm install\nnpm test' }))
    ).toEqual({
      options: {
        startupCommand: 'cd app; npm install; npm test',
        startupCommandDelivery: 'shell-ready'
      }
    })
  })

  it('forces shell-ready delivery for commands that resemble bare agent launches', () => {
    expect(buildMobileQuickCommandLaunch(command({ command: 'codex exec --full-auto' }))).toEqual({
      options: {
        startupCommand: 'codex exec --full-auto',
        startupCommandDelivery: 'shell-ready'
      }
    })
  })

  it('keeps append-enter-off commands as unsubmitted terminal input', () => {
    const multiline = 'printf "first\\nsecond"\n# leave this unsubmitted'
    expect(
      buildMobileQuickCommandLaunch(command({ command: multiline, appendEnter: false }))
    ).toEqual({
      options: { initialPrompt: multiline, enter: false, successToast: 'Command inserted' }
    })
  })

  it('injects supported agent prompts into the host-built launch command', () => {
    expect(
      buildMobileQuickCommandLaunch(
        command({
          action: 'agent-prompt',
          agent: 'codex',
          prompt: 'Review this diff'
        })
      )
    ).toEqual({ agent: 'codex', options: { agentPrompt: 'Review this diff' } })
  })

  it('bounds native row text without truncating searchable or executable content', () => {
    const longPrompt = `Review ${'x'.repeat(5993)}`
    const agentCommand = command({
      action: 'agent-prompt',
      agent: 'codex',
      prompt: longPrompt
    })

    expect(getQuickCommandDisplayPreview(agentCommand)).toHaveLength(240)
    expect(getQuickCommandDisplayPreview(agentCommand)).toMatch(/^Codex: Review .*…$/)
    expect(getQuickCommandPreview(agentCommand)).toBe(`Codex: ${longPrompt}`)
    expect(buildMobileQuickCommandLaunch(agentCommand)).toEqual({
      agent: 'codex',
      options: { agentPrompt: longPrompt }
    })
  })
})

// The row preview is cut at 240 UTF-16 code units (239 and an ellipsis). An
// emoji is two, and a cut between them drew half of it, a broken glyph, before
// the ellipsis.
describe('a quick command row with an emoji at the 240-character cap', () => {
  const LONE_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
  const ROCKET = '🚀'
  // `git commit -m "` is 15 code units, so the filler puts the rocket at `index`.
  const commitWithRocketAt = (index: number) =>
    command({ command: `git commit -m "${'x'.repeat(index - 15)}${ROCKET} release notes for the phone"` })

  it('keeps a rocket emoji whole when it straddles the cut', () => {
    const preview = getQuickCommandDisplayPreview(commitWithRocketAt(238))
    expect(preview).not.toMatch(LONE_HALF)
    expect(preview).toBe(`git commit -m "${'x'.repeat(223)}…`)
  })

  it('keeps a rocket emoji whole in an agent prompt row when it straddles the cut', () => {
    // "Codex: " is 7 code units.
    const preview = getQuickCommandDisplayPreview(
      command({ action: 'agent-prompt', agent: 'codex', prompt: `${'y'.repeat(231)}${ROCKET} and then ship it` })
    )
    expect(preview).not.toMatch(LONE_HALF)
    expect(preview).toBe(`Codex: ${'y'.repeat(231)}…`)
  })

  it('keeps an emoji that ends just before the cut', () => {
    expect(getQuickCommandDisplayPreview(commitWithRocketAt(237))).toBe(
      `git commit -m "${'x'.repeat(222)}${ROCKET}…`
    )
  })

  it('shows a command of exactly 240 code units whole, and cuts one a unit over', () => {
    const exact = `${'x'.repeat(238)}${ROCKET}`
    expect(getQuickCommandDisplayPreview(command({ command: exact }))).toBe(exact)
    const over = `${'x'.repeat(238)}${ROCKET}z`
    const cut = getQuickCommandDisplayPreview(command({ command: over }))
    expect(cut).not.toMatch(LONE_HALF)
    expect(cut).toBe(`${'x'.repeat(238)}…`)
  })

  it('shows an empty command as empty', () => {
    expect(getQuickCommandDisplayPreview(command({ command: '' }))).toBe('')
  })

  it('cuts a command made only of emoji between two of them', () => {
    const preview = getQuickCommandDisplayPreview(command({ command: ROCKET.repeat(130) }))
    expect(preview).not.toMatch(LONE_HALF)
    expect(preview).toBe(`${ROCKET.repeat(119)}…`)
  })
})
