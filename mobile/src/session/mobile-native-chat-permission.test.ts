import { describe, expect, it } from 'vitest'
import { detectAgentPermission, parseApprovalFromStatus } from './mobile-native-chat-permission'

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
