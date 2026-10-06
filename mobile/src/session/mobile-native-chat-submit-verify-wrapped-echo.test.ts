import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { claudeComposerLive, claudeSentBashTexts, claudeSentPromptTexts } from './claude-composer-screen'
import { verifyClaudeSubmit } from './mobile-native-chat-submit-verify'

// A sent prompt's echo row is as long as the terminal is wide, and a phone-fit tab is about
// 51 columns or fewer. The verifier asked that row to hold the first 40 non-space characters
// of the message, so a delivered message of ordinary length never found its own echo, was
// held as `unknown`, and the chat said "Delivery unconfirmed — check chat before retrying"
// 20 s later over a message that had arrived.
//
// SHAPE: captured from Claude Code 2.1.290 with `orca terminal read --screen` on a wrapped
// echo (2026-10-06): `❯ ` and a plain space at column 0, the continuation rows at exactly two
// spaces, a named top rule over `❯` + a no-break space, a bare bottom rule, the footer under
// it at two spaces. EVERY WORD here is synthetic. MODELLED: where Claude breaks a row at 40 to
// 51 columns (word boundary, width less the two-column gutter) was not captured at those
// widths. The `! ` row's wrap is modelled from the same shape; its wrap was never captured.

const NB = ' '
const rule = (width: number): string => '─'.repeat(width)
const namedRule = (width: number, name: string): string => '─'.repeat(width - name.length - 3) + ` ${name} ─`

/** Claude's wrap of a sent prompt: first row after `lead`, then rows at two spaces. */
function wrapped(lead: string, text: string, width: number): string[] {
  const room = width - lead.length
  const rows: string[] = []
  let row = ''
  for (const word of text.split(' ')) {
    if (row !== '' && row.length + 1 + word.length > room) {
      rows.push(row)
      row = word
    } else {
      row = row === '' ? word : `${row} ${word}`
    }
  }
  rows.push(row)
  return rows.map((part, index) => (index === 0 ? `${lead}${part}` : `  ${part}`))
}

const composer = (width: number): string[] => [
  namedRule(width, 'lantern-notes'),
  `❯${NB}`,
  rule(width),
  '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents'
]

function client(lines: string[]): RpcClient {
  return {
    sendRequest: vi.fn(async () => ({
      id: 'r',
      ok: true,
      result: { terminal: { source: 'screen', tail: lines, draft: '' } }
    }))
  } as unknown as RpcClient
}

async function verdict(
  lines: string[],
  text: string,
  extra: Partial<Parameters<typeof verifyClaudeSubmit>[0]> = {}
): Promise<string> {
  let now = 0
  const result = await verifyClaudeSubmit({
    client: client(lines),
    terminal: 'term',
    text,
    seenNonces: new Set(),
    wait: async (ms) => {
      now += ms
    },
    now: () => now,
    ...extra
  })
  return result.kind
}

const LONG = 'rotate the blue lantern seven times then report the count of candles left'
const EARLIER_SAME_START = 'rotate the blue lantern seven times then stop and wait for the keeper'
const EARLIER_PREFIX_ONLY = 'rotate the blue lantern seven'

describe('a long message sent from a phone-width tab is confirmed sent, not "Delivery unconfirmed"', () => {
  for (const width of [51, 44, 40]) {
    it(`reads its own echo at ${width} columns`, async () => {
      const lines = [...wrapped('❯ ', LONG, width), ...composer(width)]

      expect(await verdict(lines, LONG)).toBe('sent')
    })
  }

  it('reads its own echo at 51 columns when the message is made of short words', async () => {
    const text = 'go to the old red barn and see if my big hat is on the peg by the door now'
    const lines = [...wrapped('❯ ', text, 51), ...composer(51)]

    expect(await verdict(lines, text)).toBe('sent')
  })

  it('reads a one-row echo of a short message', async () => {
    const lines = [...wrapped('❯ ', 'stack the red crates', 51), ...composer(51)]

    expect(await verdict(lines, 'stack the red crates')).toBe('sent')
  })

  it('says nothing was seen when no echo is drawn and the input is empty', async () => {
    expect(await verdict(composer(44), LONG)).toBe('unknown')
  })

  it('does not take an earlier prompt that starts the same way for this message', async () => {
    for (const width of [51, 44, 40]) {
      const lines = [...wrapped('❯ ', EARLIER_SAME_START, width), ...composer(width)]

      expect(await verdict(lines, LONG)).toBe('unknown')
    }
  })

  it('does not take an earlier prompt that is only the start of this message', async () => {
    for (const width of [51, 44, 40]) {
      const lines = [...wrapped('❯ ', EARLIER_PREFIX_ONLY, width), ...composer(width)]

      expect(await verdict(lines, LONG)).toBe('unknown')
    }
  })

  it('finds its echo among earlier prompts', async () => {
    const lines = [
      ...wrapped('❯ ', EARLIER_SAME_START, 44),
      '⏺ The keeper waits.',
      ...wrapped('❯ ', LONG, 44),
      ...composer(44)
    ]

    expect(await verdict(lines, LONG)).toBe('sent')
  })

  it('confirms a photo with a long caption at phone width', async () => {
    const caption = 'the green kettle with a long caption about the steam rising from it'
    const lines = [...wrapped('❯ ', `[Image #1] ${caption}`, 44), ...composer(44)]

    expect(await verdict(lines, caption, { images: true })).toBe('sent')
  })

  it('confirms a `!` shell command that wrapped, once it shows more rows than before', async () => {
    const command = 'printf one two three four five six seven eight nine ten eleven'
    const lines = [...wrapped('! ', command, 44), ...composer(44)]

    expect(await verdict(lines, `!${command}`, { priorBashRows: [] })).toBe('sent')
    expect(await verdict(lines, `!${command}`, { priorBashRows: claudeSentBashTexts(lines) })).toBe('unknown')
  })
})

describe('the joined echo rows', () => {
  it('joins the first row with the rows it wrapped onto, and stops at the agent\'s own rows', () => {
    const lines = [...wrapped('❯ ', LONG, 40), '  ⎿  Read 1 file', '⏺ done', ...composer(40)]

    expect(claudeSentPromptTexts(lines)).toEqual([LONG])
  })

  it('gives one entry for a one-row prompt and none without a composer', () => {
    expect(claudeSentPromptTexts([...wrapped('❯ ', 'stack the red crates', 51), ...composer(51)])).toEqual([
      'stack the red crates'
    ])
    expect(claudeSentPromptTexts(['❯ stack the red crates', '⏺ done'])).toEqual([])
    expect(claudeSentPromptTexts([])).toEqual([])
  })
})

describe('a `/command` send while the slash popup is open under the box', () => {
  // The phone mirrors a draft onto Claude's input, so a `/compact` typed on the phone opens
  // Claude's suggestion list under the box before the send looks at the screen. Claude Code
  // 2.1.290 (`strings`, the prompt footer): the list is drawn inside a Box with `paddingX: 2`,
  // the same padding as every other row under the box, so its rows start with two spaces and
  // the input-box check still passes. Rows' words are synthetic; the indent is read from the
  // binary, not captured live.
  it('is not refused as "input box isn\'t on the desktop screen"', () => {
    const lines = [
      namedRule(44, 'lantern-notes'),
      `❯${NB}/lan`,
      rule(44),
      '  ❯ /lantern-light        Light a lantern',
      '    /lantern-trim         Trim the wick'
    ]

    expect(claudeComposerLive(lines)).toBe(true)
  })
})
