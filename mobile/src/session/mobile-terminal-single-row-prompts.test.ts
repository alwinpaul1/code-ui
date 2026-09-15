import { describe, expect, it } from 'vitest'
import { sentPromptsFromScreen } from './mobile-terminal-sent-prompts'

// The witness reads the `❯` ROW AND NOTHING ELSE.
//
// Removing it entirely was wrong. Two prompts the terminal had accepted were in
// no transcript file in either profile (searched 2026-09-15): Claude paints a
// queued prompt into its scrollback when it takes it, and writes the row only
// when it PROCESSES it. Between those two moments the screen is the only
// witness, which is what this was for.
//
// But reading the rows UNDER the prompt is what produced every defect reported
// that evening — the agent's prose sits on two-space rows shaped exactly like a
// wrapped prompt, so replies were glued into messages (one bubble ended in the
// agent's own "session:ok"). Nothing visible tells them apart, so nothing is
// taken from them. A long prompt comes back as its first row, which is a prefix
// of the real one, and retirement handles a prefix.
describe('what is read from an accepted prompt', () => {
  it('reads a single-row prompt whole', () => {
    expect(
      sentPromptsFromScreen(['❯ pull from main to both prs 919 and 932', '', '❯ '])
    ).toEqual(['pull from main to both prs 919 and 932'])
  })

  it('reads both prompts of a run, with the agent’s work between them', () => {
    expect(
      sentPromptsFromScreen([
        '❯ pull from main to both prs 919 and 932',
        '  Ran 1 shell command',
        '❯ also after push changes from main to both prs comment "@claude" on pr 919',
        '',
        '❯ '
      ])
    ).toEqual([
      'pull from main to both prs 919 and 932',
      'also after push changes from main to both prs comment "@claude" on pr 919'
    ])
  })

  it('never takes the agent’s reply, however it is shaped', () => {
    const prompts = sentPromptsFromScreen([
      '❯ 1050 is daimler thingy',
      '',
      "  I can't confirm it from here: distinguishing the two needs the raw",
      '  battery_power_kw series from ev_oem_telemetry.',
      '  session:ok',
      '',
      '❯ '
    ])
    expect(prompts).toEqual(['1050 is daimler thingy'])
  })

  it('never takes the rows straight under a prompt either', () => {
    expect(
      sentPromptsFromScreen([
        '❯ push',
        "  I can't confirm it from here: the raw series is unreadable.",
        '',
        '❯ '
      ])
    ).toEqual(['push'])
  })

  it('still keeps the image markers on the row it reads', () => {
    expect(
      sentPromptsFromScreen(['❯ [Image #196] look at this', '  ⎿ [Image #196]', '', '❯ '])
    ).toEqual(['[Image #196] look at this'])
  })

  it('still refuses a row the screen cut short', () => {
    // A prefix ending in the terminal's own ellipsis can never match its row.
    expect(sentPromptsFromScreen(['❯ a very long message that got cut…', '❯ '])).toEqual([])
  })

  it('still refuses a slash command and a harness notice', () => {
    expect(sentPromptsFromScreen(['❯ /model opus', '', '❯ '])).toEqual([])
    expect(
      sentPromptsFromScreen(['❯ Message from @someone (ctrl+o to expand)', '', '❯ '])
    ).toEqual([])
  })

  it('reads nothing at all from a screen with no composer', () => {
    expect(sentPromptsFromScreen(['❯ orphaned prompt'])).toEqual([])
  })
})
