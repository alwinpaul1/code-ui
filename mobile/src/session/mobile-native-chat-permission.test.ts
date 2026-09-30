import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectAgentPermission, parseApprovalFromStatus } from './mobile-native-chat-permission'
import { parseAgentQuestion } from './mobile-native-chat-question'

describe('detectAgentPermission', () => {
  it('returns null for a working agent even with permission-like text', () => {
    expect(
      detectAgentPermission({
        state: 'working',
        lastAssistantMessage: 'Do you want to proceed? (y/n)'
      })
    ).toBeNull()
  })

  it('returns null when state is undefined', () => {
    expect(
      detectAgentPermission({ lastAssistantMessage: 'Do you want to proceed? (y/n)' })
    ).toBeNull()
  })

  it('returns null for ordinary prose while blocked', () => {
    expect(
      detectAgentPermission({
        state: 'blocked',
        lastAssistantMessage: 'I finished editing the file and ran the tests.'
      })
    ).toBeNull()
  })

  it('returns null when the message is empty', () => {
    expect(detectAgentPermission({ state: 'waiting', lastAssistantMessage: '   ' })).toBeNull()
  })

  it('detects a (y/n) prompt and offers Allow/Deny with y/n send values', () => {
    const result = detectAgentPermission({
      state: 'waiting',
      lastAssistantMessage: 'Allow running `rm -rf build`? (y/n)'
    })
    expect(result).not.toBeNull()
    expect(result?.title).toBe('Permission requested')
    expect(result?.options).toEqual([
      { label: 'Allow', send: 'y' },
      { label: 'Deny', send: 'n' }
    ])
    expect(result?.detail).toContain('Allow running')
  })

  it('detects a numbered allow/deny menu and sends the digit', () => {
    const result = detectAgentPermission({
      state: 'blocked',
      lastAssistantMessage:
        'Claude wants to edit App.tsx. Do you want to proceed?\n' +
        '1. Yes\n' +
        '2. No, and tell Claude what to do differently'
    })
    expect(result).not.toBeNull()
    expect(result?.options).toHaveLength(2)
    expect(result?.options[0]).toEqual({ label: 'Yes', send: '1' })
    expect(result?.options[1]?.send).toBe('2')
    expect(result?.options[1]?.label).toContain('No')
  })

  it('handles parenthesized numbered options "1) Yes 2) No"', () => {
    const result = detectAgentPermission({
      state: 'waiting',
      lastAssistantMessage: 'Approve this command?\n1) Yes\n2) No'
    })
    expect(result?.options.map((o) => o.send)).toEqual(['1', '2'])
  })

  it('supports a three-option numbered menu (Yes / Yes always / No)', () => {
    const result = detectAgentPermission({
      state: 'blocked',
      lastAssistantMessage:
        "Allow this tool call?\n1. Yes\n2. Yes, and don't ask again this session\n3. No"
    })
    expect(result?.options).toHaveLength(3)
    expect(result?.options.map((o) => o.send)).toEqual(['1', '2', '3'])
  })

  it('adds an "Allow always" option when the text offers a persistent grant', () => {
    const result = detectAgentPermission({
      state: 'waiting',
      lastAssistantMessage:
        'Do you want to allow this? You can allow always for this session. (y/n)'
    })
    expect(result?.options.map((o) => o.label)).toEqual(['Allow', 'Allow always', 'Deny'])
    expect(result?.options.map((o) => o.send)).toEqual(['y', 'a', 'n'])
  })

  it('detects keyword-only permission asks without explicit y/n tokens', () => {
    const result = detectAgentPermission({
      state: 'blocked',
      lastAssistantMessage: 'I need your permission to run this Bash command.'
    })
    expect(result).not.toBeNull()
    expect(result?.options.map((o) => o.send)).toEqual(['y', 'n'])
  })

  it('detects "approve" / "deny" phrasing', () => {
    const result = detectAgentPermission({
      state: 'waiting',
      lastAssistantMessage: 'Please approve or deny this write to /etc/hosts.'
    })
    expect(result).not.toBeNull()
    expect(result?.options).toHaveLength(2)
  })

  it('truncates a very long detail line', () => {
    const long = `Do you want to proceed? ${'x'.repeat(300)}`
    const result = detectAgentPermission({ state: 'waiting', lastAssistantMessage: long })
    expect(result).not.toBeNull()
    expect((result?.detail ?? '').length).toBeLessThanOrEqual(160)
  })

  it('preserves long numbered option labels and their exact response', () => {
    const result = detectAgentPermission({
      state: 'blocked',
      lastAssistantMessage:
        'Proceed?\n1. Yes\n2. No, and explain in great detail exactly why this particular approach is wrong'
    })
    const second = result?.options[1]
    expect(second?.send).toBe('2')
    expect(second?.label).toBe(
      'No, and explain in great detail exactly why this particular approach is wrong'
    )
  })
})

// The card's detail line is cut at 160 UTF-16 code units (159 and an
// ellipsis). An emoji is two, and a cut between them drew half of it, a broken
// glyph, on the permission card before the ellipsis.
describe('a permission card whose detail has an emoji at the 160-character cap', () => {
  const LONE_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
  const ROCKET = '🚀'
  /** `head`, padded with x's so the rocket starts on code unit `index`, then `tail`. */
  const rocketAt = (head: string, index: number, tail: string) =>
    `${head}${'x'.repeat(index - head.length)}${ROCKET}${tail}`
  const detailOf = (lastAssistantMessage: string) =>
    detectAgentPermission({ state: 'blocked', lastAssistantMessage })?.detail

  it('keeps a rocket emoji whole in a Claude Code numbered ask when it straddles the cut', () => {
    const detail = detailOf(
      `${rocketAt('Claude wants to run `echo "', 158, ' deployed"`. Do you want to proceed?')}\n` +
        '1. Yes\n' +
        '2. No, and tell Claude what to do differently'
    )
    expect(detail).not.toMatch(LONE_HALF)
    expect(detail).toBe(`${rocketAt('Claude wants to run `echo "', 158, '').slice(0, 158)}…`)
  })

  it('keeps a rocket emoji whole in a Codex y/n ask when it straddles the cut', () => {
    const detail = detailOf(rocketAt('Allow Codex to run `git commit -m "', 158, ' ship"`? (y/n)'))
    expect(detail).not.toMatch(LONE_HALF)
    expect(detail).toBe(`${rocketAt('Allow Codex to run `git commit -m "', 158, '').slice(0, 158)}…`)
  })

  it('keeps an emoji that ends just before the cut', () => {
    const line = rocketAt('Do you want to proceed? ', 157, ' tail')
    expect(detailOf(line)).toBe(`${line.slice(0, 159)}…`)
    expect(line.slice(157, 159)).toBe(ROCKET)
  })

  it('shows a detail of exactly 160 code units whole, and cuts one a unit over', () => {
    const exact = rocketAt('Do you want to proceed? ', 158, '')
    expect(exact).toHaveLength(160)
    expect(detailOf(exact)).toBe(exact)
    const over = detailOf(`${exact}!`)
    expect(over).not.toMatch(LONE_HALF)
    expect(over).toBe(`${exact.slice(0, 158)}…`)
  })

  it('keeps an ask whose first line is empty with no detail at all', () => {
    const result = detectAgentPermission({ state: 'blocked', lastAssistantMessage: '\nDo you want to proceed? (y/n)' })
    expect(result).not.toBeNull()
    expect(result?.detail).toBeUndefined()
  })

  it('cuts a detail made only of emoji between two of them', () => {
    const result = detectAgentPermission({
      state: 'blocked',
      lastAssistantMessage: `${ROCKET.repeat(100)}\nDo you want to proceed? (y/n)`
    })
    expect(result?.detail).not.toMatch(LONE_HALF)
    expect(result?.detail).toBe(`${ROCKET.repeat(79)}…`)
  })
})

// 2026-09-30: on a waiting or blocked tab, a last message with an approval
// word in it ("do you want to", "would you like to", "allow", "confirm")
// became a "Permission requested" card, and every numbered line anywhere in it
// became a button sending its digit. A choice of database showed as a
// permission, and a plan's steps were offered as the answers to "go ahead?",
// with no Allow or Deny at all.
const ALLOW_DENY = [
  { label: 'Allow', send: 'y' },
  { label: 'Deny', send: 'n' }
]
const askWhileWaiting = (lastAssistantMessage: string) =>
  detectAgentPermission({ state: 'waiting', lastAssistantMessage })

describe('a paused agent asking a question or listing a plan', () => {
  it('leaves a choice of database to the question card, not "Permission requested"', () => {
    const text = 'Which database do you want to use?\n\n1. Postgres\n2. SQLite'
    expect(askWhileWaiting(text)).toBeNull()
    expect(detectAgentPermission({ state: 'blocked', lastAssistantMessage: text })).toBeNull()
    // The card that draws instead: the two choices.
    expect(parseAgentQuestion(text)?.options).toEqual(['Postgres', 'SQLite'])
  })

  it('asks Allow or Deny for a plan that asks to go ahead, never offering its steps', () => {
    const permission = askWhileWaiting(
      'I will make these changes:\n1. Edit a.ts\n2. Edit b.ts\n\nDo you want to go ahead?'
    )
    expect(permission?.title).toBe('Permission requested')
    expect(permission?.options).toEqual(ALLOW_DENY)
  })

  // "Skip" and "Cancel" can answer an approval, but steps that all begin with
  // one are still steps: a menu offers a way to say yes AND a way to say no.
  it('asks Allow or Deny for a plan whose steps begin with approval words', () => {
    const permission = askWhileWaiting(
      'Next steps:\n1. Skip the flaky test\n2. Cancel the old job\n\nDo you want to proceed?'
    )
    expect(permission?.options).toEqual(ALLOW_DENY)
  })

  it('leaves a bulleted choice of database to the question card', () => {
    const text = 'Which database would you like to use?\n- Postgres\n- SQLite'
    expect(askWhileWaiting(text)).toBeNull()
    expect(parseAgentQuestion(text)?.options).toEqual(['Postgres', 'SQLite'])
  })

  it('still asks Allow or Deny when the bullets are Yes and No', () => {
    expect(askWhileWaiting('Do you want to proceed?\n- Yes\n- No')?.options).toEqual(ALLOW_DENY)
  })

  // A known limit, not a goal: choices that begin with a yes and a no read
  // as a menu. The card is titled wrong, but each button still sends the
  // agent's own digit, so the answer it gives is the one the agent listed.
  it('still titles a choice between "Allow…" and "Skip…" a permission, by its own digits', () => {
    const permission = askWhileWaiting(
      'Which do you want?\n1. Allow retries with backoff\n2. Skip retries entirely'
    )
    expect(permission?.title).toBe('Permission requested')
    expect(permission?.options.map((o) => o.send)).toEqual(['1', '2'])
  })
})

/** The screen rows under a fixture's `=== screen: … ===` marker. */
function readScreen(name: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
  const rows = text.split('\n')
  const marker = rows.findIndex((row) => /^=== screen: .* ===$/.test(row))
  return rows.slice(marker + 1)
}

describe("an approval menu keeps each agent's own choices", () => {
  // Claude Code 2.1.283's Bash dialog, from its title row down (a
  // transcription of the user's screen; see the fixture's header).
  const claudeRows = readScreen('claude-screen-subagent-bash-permission-2.1.283.txt')
  const CLAUDE_DIALOG = claudeRows
    .slice(claudeRows.indexOf(' Bash command · from the general-purpose agent'))
    .join('\n')
  // The Codex approval dialog pinned in codex-terminal-permission.test.ts
  // (2026-09-06). Which Codex build drew it is not recorded there.
  const CODEX_DIALOG = [
    'Would you like to run the following command?',
    '',
    'Environment: local',
    'Reason: May I run the full test suite, including the local WebSocket integration tests?',
    '',
    '  $ pnpm exec vitest run > /tmp/codeui-026-tests.log 2>&1',
    '',
    '› 1. Yes, proceed (y)',
    "  2. Yes, and don't ask again for commands that start with `pnpm exec vitest` (p)",
    '  3. No, and tell Codex what to do differently (esc)',
    '',
    'Press enter to confirm or esc to cancel'
  ]

  // The selected row carries a `❯` (Claude) or `›` (Codex) in front of its
  // digit, which dropped it from the card before 2026-09-30.
  it("offers Claude Code's three choices by their digits, the selected one too", () => {
    const permission = detectAgentPermission({
      state: 'blocked',
      lastAssistantMessage: CLAUDE_DIALOG
    })
    expect(permission?.options).toEqual([
      { label: 'Yes', send: '1' },
      { label: 'Yes, and don’t ask again for: git *', send: '2' },
      { label: 'No', send: '3' }
    ])
  })

  it("offers Codex's three choices by their digits, the selected one too", () => {
    expect(askWhileWaiting(CODEX_DIALOG.join('\n'))?.options).toEqual([
      { label: 'Yes, proceed (y)', send: '1' },
      {
        label: "Yes, and don't ask again for commands that start with `pnpm exec vitest` (p)",
        send: '2'
      },
      { label: 'No, and tell Codex what to do differently (esc)', send: '3' }
    ])
  })

  it('asks Allow or Deny for the Codex ask when no menu came with it', () => {
    const head = CODEX_DIALOG.slice(0, CODEX_DIALOG.indexOf('› 1. Yes, proceed (y)')).join('\n')
    expect(askWhileWaiting(head)?.options).toEqual(ALLOW_DENY)
  })

  // Claude Code 2.1.276's plan review, as claude-plan-permission.ts records
  // it: its way to say no is "Tell Claude what to change", which the card
  // needs to open the feedback sheet.
  it("keeps Claude Code's plan review a permission card, feedback option and all", () => {
    const permission = askWhileWaiting(
      'Claude has written up a plan and is ready to execute. Would you like to proceed?\n' +
        '1. Yes, and use auto mode\n' +
        '2. Yes, manually approve edits\n' +
        '3. Tell Claude what to change'
    )
    expect(permission?.options).toEqual([
      { label: 'Yes, and use auto mode', send: '1' },
      { label: 'Yes, manually approve edits', send: '2' },
      { label: 'Tell Claude what to change', send: '3' }
    ])
  })

  it('reads a bold Yes and No as an approval menu', () => {
    expect(
      askWhileWaiting('Do you want to proceed?\n1. **Yes**\n2. **No**')?.options.map((o) => o.send)
    ).toEqual(['1', '2'])
  })

  // The rows the wider refusal words and the (y/n) hint (2026-10-01) must
  // leave alone: each agent's way to say no ("No, and tell Claude…", "No, and
  // tell Codex…"), and the `(esc)` and `(p)` hints wrapped onto rows of their
  // own. Claude Code's Bash dialog as mobile-terminal-permission-options.test.ts
  // pins it (its build is not recorded there), cut out of its frame.
  it("keeps Claude Code's Bash dialog with wrapped rows a numbered permission card", () => {
    const permission = askWhileWaiting(
      [
        'Bash command',
        '  rm -rf build',
        '  Remove the build directory',
        'Do you want to proceed?',
        '❯ 1. Yes',
        "  2. Yes, and don't ask again for rm commands in",
        '     /Users/alwinpaul/Desktop/Project/Code UI',
        '  3. No, and tell Claude what to do differently',
        '     (esc)'
      ].join('\n')
    )
    expect(permission?.title).toBe('Permission requested')
    expect(permission?.options).toEqual([
      { label: 'Yes', send: '1' },
      { label: "Yes, and don't ask again for rm commands in", send: '2' },
      { label: 'No, and tell Claude what to do differently', send: '3' }
    ])
  })

  // The wrapped row codex-terminal-permission.test.ts pins for the same dialog.
  it("keeps Codex's dialog with a wrapped don't-ask-again row a numbered permission card", () => {
    const wrapped = [...CODEX_DIALOG]
    wrapped.splice(
      8,
      1,
      "  2. Yes, and don't ask again for commands that start with",
      '     `pnpm exec vitest` (p)'
    )
    const permission = askWhileWaiting(wrapped.join('\n'))
    expect(permission?.title).toBe('Permission requested')
    expect(permission?.options.map((o) => o.send)).toEqual(['1', '2', '3'])
    expect(permission?.options[2]?.label).toBe('No, and tell Codex what to do differently (esc)')
  })
})

// 2026-10-01 review: an approval menu worded "Approve / Decline" or "Yes /
// Not now" lost its "Permission requested" card. Neither "Decline" nor "Not
// now" read as a way to say no, so the reply had no menu, and the question
// card drew the two choices instead. These menus are agent prose, not a
// captured screen: no agent build is recorded for them.
describe('an approval menu worded outside Yes and No', () => {
  it('keeps the permission card for a menu worded Approve and Decline', () => {
    const permission = askWhileWaiting('Do you want to proceed?\n 1. Approve\n 2. Decline')
    expect(permission?.title).toBe('Permission requested')
    expect(permission?.options).toEqual([
      { label: 'Approve', send: '1' },
      { label: 'Decline', send: '2' }
    ])
  })

  it('keeps the permission card for a menu worded Yes and Not now', () => {
    const permission = askWhileWaiting('Do you want to proceed?\n 1. Yes\n 2. Not now')
    expect(permission?.title).toBe('Permission requested')
    expect(permission?.options).toEqual([
      { label: 'Yes', send: '1' },
      { label: 'Not now', send: '2' }
    ])
  })

  it('keeps the permission card for a menu whose no is "Not yet…"', () => {
    expect(
      askWhileWaiting('Apply the migration? Please confirm.\n1. Yes\n2. Not yet, show me the SQL')
        ?.options
    ).toEqual([
      { label: 'Yes', send: '1' },
      { label: 'Not yet, show me the SQL', send: '2' }
    ])
  })

  it('does not read "Not sure" as a way to say no', () => {
    const text = 'Do you want to proceed?\n1. Yes\n2. Not sure'
    expect(askWhileWaiting(text)).toBeNull()
    expect(parseAgentQuestion(text)?.optionTokens).toEqual(['1', '2'])
  })

  it('does not read "Declined…" or "Nothing…" as a way to say no', () => {
    for (const text of [
      'Which do you want?\n1. Allow retries\n2. Declined payments first',
      'Which do you want?\n1. Allow retries\n2. Nothing for now'
    ]) {
      expect(askWhileWaiting(text), text).toBeNull()
      expect(parseAgentQuestion(text)?.optionTokens, text).toEqual(['1', '2'])
    }
  })

  it('asks Allow or Deny for steps that all begin "Decline…" or "Not now…"', () => {
    expect(
      askWhileWaiting(
        'Next steps:\n1. Decline the stale invites\n2. Not now: the migration\n\nDo you want to proceed?'
      )?.options
    ).toEqual(ALLOW_DENY)
  })
})

// 2026-10-01 review: a plan that ends in a "(y/n)" ask drew no Allow or Deny,
// and the question card offered its steps as the answers, so a tap sent a
// step's digit to an ask whose answer is y or n. A line asked only when it
// ended in "?", and "Shall I proceed? (y/n)" ends in ")". These asks are agent
// prose, not a captured screen: no agent build is recorded for them, and the
// repo holds no Codex "(y/n)" capture.
describe('a plan that ends in a (y/n) ask', () => {
  const STEPS = "I'll run these:\n1. npm install\n2. npm test\n\n"

  it('asks Allow or Deny after "Shall I proceed? (y/n)", never offering the steps', () => {
    const text = `${STEPS}Shall I proceed? (y/n)`
    expect(askWhileWaiting(text)?.title).toBe('Permission requested')
    expect(askWhileWaiting(text)?.options).toEqual(ALLOW_DENY)
    expect(parseAgentQuestion(text)).toBeNull()
  })

  it('asks Allow or Deny after "Allow running them? (y/n)"', () => {
    const text = `${STEPS}Allow running them? (y/n)`
    expect(askWhileWaiting(text)?.options).toEqual(ALLOW_DENY)
    expect(parseAgentQuestion(text)).toBeNull()
  })

  it('reads every spelling of the answer hint the same way', () => {
    for (const ask of [
      'Shall I proceed? [y/N]',
      'Shall I proceed? [Y/n]',
      'Shall I proceed? (Y/N)',
      'Shall I proceed? (yes/no)',
      'Shall I proceed? y/n',
      'Proceed (y/n):',
      '**Shall I proceed? (y/n)**',
      'Shall I proceed? `(y/n)`'
    ]) {
      expect(askWhileWaiting(STEPS + ask)?.options, ask).toEqual(ALLOW_DENY)
      expect(parseAgentQuestion(STEPS + ask), ask).toBeNull()
    }
  })

  it('reads a (y/n) ask run straight on from the last step as an ask, not more of it', () => {
    const text = 'Plan:\n1. npm install\n2. npm test\nShall I proceed? (y/n)'
    expect(askWhileWaiting(text)?.options).toEqual(ALLOW_DENY)
    expect(parseAgentQuestion(text)).toBeNull()
  })

  // A "(y/n)" says the answer is y or n, so a digit is never the answer: the
  // steps under the ask are what it asks about, not its choices.
  it('asks Allow or Deny when the (y/n) ask introduces the steps', () => {
    const text = 'Run these? (y/n)\n1. npm install\n2. npm test'
    expect(askWhileWaiting(text)?.options).toEqual(ALLOW_DENY)
    expect(parseAgentQuestion(text)).toBeNull()
  })

  it('asks Allow or Deny for one step under a (y/n) ask, and for a bare hint after the steps', () => {
    expect(askWhileWaiting('Run this? (y/n)\n1. npm install')?.options).toEqual(ALLOW_DENY)
    expect(parseAgentQuestion('Run this? (y/n)\n1. npm install')).toBeNull()
    expect(askWhileWaiting(`${STEPS}(y/n)`)?.options).toEqual(ALLOW_DENY)
    expect(parseAgentQuestion(`${STEPS}(y/n)`)).toBeNull()
  })

  it('leaves a choice of database to the question card under a (y/n) in a code fence', () => {
    const text =
      'Which database do you want to use?\n1. Postgres\n2. SQLite\n\n' +
      'The installer then asks:\n```\nContinue? (y/n)\n```'
    expect(askWhileWaiting(text)).toBeNull()
    expect(parseAgentQuestion(text)?.options).toEqual(['Postgres', 'SQLite'])
  })

  it('does not take a "yes/no" that closes prose as the answer hint', () => {
    const text = 'Which value should the flag take?\n1. strict\n2. loose\n\nThe old config took yes/no'
    expect(askWhileWaiting(text)).toBeNull()
    expect(parseAgentQuestion(text)?.options).toEqual(['strict', 'loose'])
  })

  // A known limit, not a goal: a numbered Yes and No under a "(y/n)" ask is
  // still a menu, answered by the agent's own digit, as each agent's numbered
  // dialog is. No agent is recorded painting this pair.
  it('still answers a numbered Yes and No under a (y/n) ask by its own digits', () => {
    expect(
      askWhileWaiting('Do you want to proceed? (y/n)\n1. Yes\n2. No')?.options.map((o) => o.send)
    ).toEqual(['1', '2'])
  })
})

describe('a numbered list in a permission ask, at its degenerate sizes and places', () => {
  it('asks Allow or Deny for a single numbered Yes', () => {
    expect(askWhileWaiting('Do you want to proceed?\n1. Yes')?.options).toEqual(ALLOW_DENY)
  })

  it('leaves a single numbered step under a question to the question card', () => {
    const text = 'Would you like to run this step:\n1. Build the app'
    expect(askWhileWaiting(text)).toBeNull()
    expect(parseAgentQuestion(text)?.options).toEqual(['Build the app'])
  })

  it('offers no line of a code fence as a choice', () => {
    expect(
      askWhileWaiting('Do you want to run this script?\n```\n1. echo a\n2. echo b\n```')?.options
    ).toEqual(ALLOW_DENY)
  })

  it('does not answer a Yes/No menu quoted in a code fence by its digits', () => {
    expect(
      askWhileWaiting('Claude Code showed:\n```\n1. Yes\n2. No\n```\nShould I allow it?')?.options
    ).toEqual(ALLOW_DENY)
  })

  it('offers the Yes/No menu at the end, not the numbered findings above it', () => {
    const permission = askWhileWaiting(
      'I found these issues:\n1. Missing null check\n2. Unused import\n\n' +
        'Do you want to apply the fixes?\n1. Yes\n2. No'
    )
    expect(permission?.options).toEqual([
      { label: 'Yes', send: '1' },
      { label: 'No', send: '2' }
    ])
  })

  it('offers the Yes/No menu, not a numbered notes list after it', () => {
    const permission = askWhileWaiting(
      'Do you want to proceed?\n1. Yes\n2. No\n\nNotes:\n1. This deletes build/\n2. It cannot be undone'
    )
    expect(permission?.options).toEqual([
      { label: 'Yes', send: '1' },
      { label: 'No', send: '2' }
    ])
  })

  it('shows nothing for an empty message', () => {
    expect(askWhileWaiting('')).toBeNull()
    expect(askWhileWaiting('\n\n')).toBeNull()
  })
})

describe('parseApprovalFromStatus', () => {
  it('parses an approval envelope into an Allow/Deny card', () => {
    const card = parseApprovalFromStatus(
      JSON.stringify({ approval: { tool: 'Bash', summary: 'rm -rf build' } })
    )
    expect(card?.title).toBe('Allow Bash?')
    expect(card?.detail).toBe('rm -rf build')
    expect(card?.options.map((o) => o.label)).toEqual(['Allow', 'Deny'])
    expect(card?.options[0]!.send).toBe('1')
  })

  it('returns null for non-approval / malformed input', () => {
    expect(parseApprovalFromStatus(undefined)).toBeNull()
    expect(parseApprovalFromStatus('{bad')).toBeNull()
    expect(parseApprovalFromStatus(JSON.stringify({ questions: [] }))).toBeNull()
    expect(parseApprovalFromStatus(JSON.stringify({ approval: {} }))).toBeNull()
  })
})
