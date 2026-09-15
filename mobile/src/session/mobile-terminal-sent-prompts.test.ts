import { describe, expect, it } from 'vitest'
import { sentPromptsFromScreen } from './mobile-terminal-sent-prompts'

const NBSP = '\u00a0'

// Claude Code 2.1.270, captured with `tmux capture-pane -p` on 2026-09-13
// (100 columns). A slash command with its output, a prompt that wrapped twice,
// the tool fold under it, the reply, and the composer with the status area
// beneath it.
const SCREEN = [
  '❯ /effort high',
  '  ⎿  Set effort level to high (saved as your default for new sessions): Comprehensive implementation',
  '     with extensive testing and documentation',
  '',
  '❯ run echo one and then echo two, then reply with the single word done',
  '  second prompt that is long enough to wrap around the terminal width of one hundred columns for',
  '  sure yes',
  '',
  '  Ran 1 shell command',
  '',
  '⏺ done',
  '',
  '  session:ok',
  '',
  '✻ Baked for 7s · done 10:25 AM',
  '',
  '────────────────────────────────────────────────────────────────────────────────────────────────────',
  `❯${NBSP}`,
  '────────────────────────────────────────────────────────────────────────────────────────────────────',
  '  [Haiku 4.5 | Max 20x] ██░░░░ 26% (52k/200k) | probe | 1 CLAUDE.md | 4 rules | 3 MCPs | 12 hooks',
  '  Usage ░░░░░░ 6% (resets 3:10 PM) | Weekly ███░░░ 46% (resets Wed 7:00 PM)',
  '  ───────────────────────────────────────────────────────────────────────────────────────────────',
  '  ✓ Bash ×1',
  '  ⏸ manual mode on · ← for agents'
]

// The same build, mid-turn, as it stood on the phone on 2026-09-13: a prompt
// with an image and two rule files loaded by a hook, then the running tool.
function midTurn(seconds: number): string[] {
  return [
    '❯ When a model switch happens this too appears fix that',
    '  ⎿  [Image #89]',
    '  ⎿  Loaded ../../../.claude/rules/no-inline-imports.md',
    '  ⎿  Loaded ../../../.claude/rules/typescript-exhaustive-switch.md',
    '',
    '  Ran 6 shell commands',
    '',
    `⏺ Bash(Drive a live Claude Code 2.1.270 in tmux and capture its real scrollback rows · ${seconds}s`,
    '  ⎿  $ cd /private/tmp/claude-501/scratchpad && mkdir -p probe && cd probe && tmux kill-session',
    `     -t cuiprobe 2>/dev/null; tmux new-session -d -s cuiprobe (${seconds}s) (ctrl+b to run in`,
    '     background)',
    '',
    '✻ Cooking… (esc to interrupt)',
    '',
    '────────────────────────────────────────────────────────────────────────────────────────────────────',
    '❯',
    '────────────────────────────────────────────────────────────────────────────────────────────────────',
    '  [Fable 5.1 | Max 20x] ██░░░░ 26% (52k/200k) | Code UI | 1 CLAUDE.md | 4 rules | 3 MCPs'
  ]
}

// Read off the phone's own terminal view of the same build (2026-09-13): a
// prompt with a second paragraph, the fold after the turn, and the reply.
const TWO_PARAGRAPHS = [
  '❯ When a model switch happens this too appears fix that and',
  '  here is the rest of the first paragraph',
  '',
  '  How did this appear fix this',
  '',
  '  Ran 1 shell command',
  '',
  '⏺ Applying the parser fix: prompt text now stops at the first blank row.',
  '',
  '  Ran 3 shell commands',
  '',
  '────────────────────────────────────────────────────────────────────────────────────────────────────',
  '❯',
  '────────────────────────────────────────────────────────────────────────────────────────────────────'
]

describe('sentPromptsFromScreen', () => {
  it('keeps a second paragraph of the prompt and still leaves the fold out', () => {
    expect(sentPromptsFromScreen(TWO_PARAGRAPHS)).toEqual([
      'When a model switch happens this too appears fix that and here is the rest of the first paragraph\n\nHow did this appear fix this'
    ])
  })

  it('reads a prompt the agent already took, rejoining the rows it wrapped', () => {
    expect(sentPromptsFromScreen(SCREEN)).toEqual([
      'run echo one and then echo two, then reply with the single word done second prompt that is long enough to wrap around the terminal width of one hundred columns for sure yes'
    ])
  })

  it('leaves the "Ran N shell commands" fold under the prompt out of it', () => {
    expect(sentPromptsFromScreen(SCREEN).join(' ')).not.toContain('Ran 1 shell command')
  })

  it('skips a slash command and the output painted under it', () => {
    const prompts = sentPromptsFromScreen(SCREEN).join(' ')
    expect(prompts).not.toContain('/effort')
    expect(prompts).not.toContain('Set effort level')
  })

  it('stops at the attachment and hook rows the agent paints under a prompt', () => {
    expect(sentPromptsFromScreen(midTurn(6))).toEqual([
      'When a model switch happens this too appears fix that'
    ])
  })

  it('reads the same text every poll while a tool timer ticks', () => {
    expect(sentPromptsFromScreen(midTurn(6))).toEqual(sentPromptsFromScreen(midTurn(13)))
  })

  it('never reads the composer, stripped bare or carrying a draft', () => {
    const typing = [...SCREEN]
    typing[17] = `❯${NBSP}a draft the user is still typing on the desktop`
    expect(sentPromptsFromScreen(typing).join(' ')).not.toContain('still typing')
    expect(sentPromptsFromScreen(midTurn(6)).join(' ')).not.toContain('Fable 5.1')
  })

  it('reads nothing when no composer row is on screen, so a live draft is never taken for a prompt', () => {
    // 2026-09-13: with no composer row found, the whole screen was parsed,
    // and the desktop's half-typed draft came back as an accepted prompt.
    expect(sentPromptsFromScreen(['❯ a prompt that was accepted', '', '⏺ reply'])).toEqual([])
  })

  it('leaves out a fold painted straight under an absorbed prompt, with no blank row', () => {
    // 2026-09-13, on the phone running 0.5.49: a message typed on the desktop
    // mid-turn came back as "fix the agent-read image thumbnail one and verify
    // on my phone Ran 7 shell commands" — the fold row sat directly under the
    // prompt, and the parser only knew to stop at one after a blank row.
    expect(
      sentPromptsFromScreen([
        '❯ fix the agent-read image thumbnail one and verify on my phone',
        '  Ran 7 shell commands',
        '',
        '❯ which is the version with all fixes',
        '',
        '❯ 0.5.48 where is this update not on ci',
        '  Ran 1 shell command',
        '',
        '⏺ Bash(Check the 0.5.48 CI run)',
        '',
        '❯ '
      ])
    ).toEqual([
      'fix the agent-read image thumbnail one and verify on my phone',
      'which is the version with all fixes',
      '0.5.48 where is this update not on ci'
    ])
  })

  it('still keeps a wrapped line that merely starts like a fold and runs on', () => {
    expect(
      sentPromptsFromScreen([
        '❯ yesterday I',
        '  Ran 3 shell commands by hand and the second one hung, can you',
        '  check why',
        '',
        '❯ '
      ])
    ).toEqual(['yesterday I Ran 3 shell commands by hand and the second one hung, can you check why'])
  })

  it('keeps a second paragraph that merely opens like a tool fold', () => {
    // 2026-09-13: "Created a branch called hud-fix, reuse it" was eaten as if
    // it were the fold, and the text was lost with no sign of it.
    expect(
      sentPromptsFromScreen([
        '❯ please look at the deploy script and tell me what is wrong',
        '',
        '  Created a branch called hud-fix earlier today, reuse it rather than',
        '  making a new one',
        '',
        '  Ran 2 shell commands',
        '',
        '⏺ looking',
        '❯ '
      ])
    ).toEqual([
      'please look at the deploy script and tell me what is wrong\n\nCreated a branch called hud-fix earlier today, reuse it rather than making a new one'
    ])
  })

  it('leaves the running tool\'s rows out of an absorbed prompt', () => {
    // Captured 2026-09-13 (2.1.270) while a tool ran: the tool's description
    // is a plain two-space row with a ticking timer, the command under it.
    expect(
      sentPromptsFromScreen([
        "❯ run exactly this one command and then say done: python3 -c 'import time; time.sleep(45)'",
        '',
        '  Running Python sleep for 45 seconds · 18s',
        "  ⎿  $ python3 -c 'import time; time.sleep(45)' (18s)",
        '     (ctrl+b ctrl+b (twice) to run in background)',
        '',
        '✢ Thinking… (21s · ↓ 172 tokens)',
        '',
        '  ❯ this is a message typed while you were busy',
        '',
        '────────────────────────────────────────────────────────────────────────────────────────────────────',
        '❯\u00a0Press up to edit queued messages',
        '────────────────────────────────────────────────────────────────────────────────────────────────────'
      ])
    ).toEqual(["run exactly this one command and then say done: python3 -c 'import time; time.sleep(45)'"])
    // "Reading 1 file…" under a prompt, seen on the phone on 2026-09-13.
    expect(
      sentPromptsFromScreen(['❯ phone test message from adb', '  Reading 1 file…', '', '❯ '])
    ).toEqual(['phone test message from adb'])
    // And the shape the phone showed: the description glued straight under
    // the prompt, no blank row, then its command.
    expect(
      sentPromptsFromScreen([
        '❯ see these messages what happening dude',
        '  Capturing the phone screen right now',
        '  ⎿  $ adb exec-out screencap',
        '',
        '❯ '
      ])
    ).toEqual(['see these messages what happening dude'])
  })

  it('never reads a markdown blockquote in the agent\'s own answer as a message', () => {
    // 2026-09-13: `> quoted line` at column 0 inside an answer came back as a
    // message the user had sent, and it could never retire.
    expect(
      sentPromptsFromScreen(['⏺ quoting the docs:', '', '> a quoted line', '', '❯ '])
    ).toEqual([])
  })

  it('never reads an incoming teammate message notice as something the user sent', () => {
    // 2026-09-13, on the phone: "Message from @review-sonnet (ctrl+o to
    // expand)" stood as a user bubble. Claude Code paints it in the prompt's
    // own shape, and no transcript row ever lands to retire it.
    expect(
      sentPromptsFromScreen([
        '❯ Message from @review-sonnet (ctrl+o to expand)',
        '',
        '❯ see my mobile screen there is a issue',
        '',
        '❯ '
      ])
    ).toEqual(['see my mobile screen there is a issue'])
  })

  it('returns nothing for a screen with no prompt rows', () => {
    expect(sentPromptsFromScreen(['  Ran 3 shell commands', '', '✻ Cooking…', '❯'])).toEqual([])
  })

  it('does not glue a message typed while the agent was busy onto the running prompt', () => {
    // Captured with `tmux capture-pane` against Claude Code 2.1.270 at 100
    // columns (2026-09-14). Type while it is working and each entry stacks as a
    // plain two-space row directly under the accepted prompt — no marker, no
    // blank row — the same shape as a wrapped continuation. On the phone the
    // user's prompt came back with an /effort switch glued onto the end of it.
    const screen = [
      '\u276f run exactly this and say done: python3 -c "import time; time.sleep(40)"',
      '  this is a long message the user typed while the agent was busy working on the sleep',
      '  /effort high',
      '\u2736 Herding\u2026 (2s \u00b7 thinking)',
      '',
      '\u276f\u00a0'
    ]
    expect(sentPromptsFromScreen(screen).join(' ')).not.toContain('/effort')
    // The plain message above it is NOT split off: at a two-space indent it is
    // byte-identical to a wrapped continuation of the prompt, and this parser
    // refuses to guess between them rather than risk cutting a real prompt in
    // half. It retires normally once the agent takes it.
    expect(sentPromptsFromScreen(screen)).toHaveLength(1)
  })

  it('leaves a model or effort switch out of the prompt above it', () => {
    expect(
      sentPromptsFromScreen([
        '\u276f Did you do all the changes i told in this session',
        '  /model opus',
        '  /effort xhigh',
        '',
        '\u276f '
      ])
    ).toEqual(['Did you do all the changes i told in this session'])
  })
})

it('leaves the effort and mode picker rows out of the prompt above them', () => {
  // 2026-09-14, from the phone: a sent message came back with "xhigh · /effort"
  // glued on its end. Claude draws the picker's chosen row with a radio glyph,
  // which the continuation rule did not exclude — and once the bubble's text
  // had that suffix it no longer matched its own queue row, so the message
  // showed as sent AND queued at the same time.
  expect(
    sentPromptsFromScreen([
      '❯ Same message goes with images and text glued',
      '  ◉ xhigh · /effort',
      '',
      '❯ '
    ])
  ).toEqual(['Same message goes with images and text glued'])
  for (const glyph of ['◉', '○', '●', '◦']) {
    expect(
      sentPromptsFromScreen([`❯ pick a mode`, `  ${glyph} manual · /mode`, '', '❯ '])
    ).toEqual(['pick a mode'])
  }
})

it('keeps a bullet list the user wrote, and the lines after it', () => {
  // 2026-09-14 review: excluding the radio glyph outright ended the prompt at
  // any bullet, and everything after it was dropped with no second prompt.
  expect(
    sentPromptsFromScreen([
      '❯ here is my plan, pick one of these:',
      '  ○ ship it today',
      '  ● ship it tomorrow',
      '  and tell me which you picked and why',
      '',
      '❯ '
    ])
  ).toEqual([
    'here is my plan, pick one of these: ○ ship it today ● ship it tomorrow and tell me which you picked and why'
  ])
})

it('leaves a hyphenated picker row out too, and keeps what follows it', () => {
  // 2026-09-14 review: the picker pattern required \w+ after the slash, so
  // `/output-style` was not recognised and glued itself onto the prompt — the
  // same "sent AND queued" symptom, just for a different picker. And ending the
  // block at a picker row threw away everything after it.
  expect(
    sentPromptsFromScreen([
      '❯ set it up the way I like',
      '  ◉ asd-ste100 · /output-style',
      '  and then run the tests',
      '',
      '❯ '
    ])
  ).toEqual(['set it up the way I like and then run the tests'])
})

// Real bytes, `orca terminal read --screen` against a live Claude pr-919
// session on 2026-09-15 (Claude Code 2.1.270). The prompt row was CUT by the
// screen — it ends in an ellipsis — and the agent's reply is printed beneath it
// on rows indented exactly two spaces, the same shape a wrapped prompt uses.
// The parser read the whole reply as more prompt, so the phone drew the user's
// message and the answer to it as one bubble.
describe('a prompt the screen cut short', () => {
  const SCREEN = [
    '❯ One caveat worth your attention: the geometry-persistence change writes a new key into a live JSONB column on every reroute. The te…',
    '  - F8 offline restoration — left off on your call. It is a parked product decision, not a defect.',
    '  - Native device verification — none of the HERE truck-routing work, the tab-bar badge, or the phone sheet has been seen on a handset.',
    '  And the honest caveat on my own record this session: the peer reviewer caught real defects twice.',
    '  session:ok',
    '',
    '❯ '
  ]

  it('does not read the reply printed under it as more of the message', () => {
    const [prompt = ''] = sentPromptsFromScreen(SCREEN)
    expect(prompt).toContain('One caveat worth your attention')
    expect(prompt).not.toContain('F8 offline restoration')
    expect(prompt).not.toContain('session:ok')
  })

  // A prompt the screen did NOT cut still gathers its own wrapped rows.
  it('still gathers the wrapped rows of a prompt that was not cut', () => {
    const [prompt = ''] = sentPromptsFromScreen([
      '❯ first line of what I typed',
      '  - a bullet I wrote myself',
      '  and a second paragraph',
      '',
      '❯ '
    ])
    expect(prompt).toContain('a bullet I wrote myself')
    expect(prompt).toContain('second paragraph')
  })
})
