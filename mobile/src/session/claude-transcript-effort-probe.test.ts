import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { EFFORT_PROBE_MAX_PAGES, EFFORT_PROBE_PAGE, walkTranscriptForCommandPair, type ProbePageParams } from './claude-transcript-effort-probe'

let n = 0
const row = (role: 'user' | 'assistant', text: string): NativeChatMessage => ({
  id: `r${(n += 1)}`,
  role,
  blocks: [{ type: 'text', text }],
  timestamp: n * 1000,
  source: 'transcript'
})
// The two rows Claude Code 2.1.296 writes for `/effort high` (captured,
// fixtures/claude-effort-command-2.1.296.ts), as Orca's decoder hands them on.
const effortHigh = (): NativeChatMessage[] => [
  row('user', '<command-name>/effort</command-name>\n            <command-message>effort</command-message>\n            <command-args>high</command-args>'),
  row('user', '<local-command-stdout>Set effort level to high (saved as your default for new sessions): Comprehensive implementation with extensive testing and documentation</local-command-stdout>')
]
const replies = (count: number) => Array.from({ length: count }, () => row('assistant', 'Done.'))

/** Orca's readSession over `file`, recording each request. */
function host(file: NativeChatMessage[]) {
  const asked: ProbePageParams[] = []
  const read = async (params: ProbePageParams) => {
    asked.push(params)
    const end = params.beforeOffset ?? file.length
    const start = Math.max(0, end - params.limit)
    return { messages: file.slice(start, end), hasMore: start > 0, beforeOffset: start }
  }
  return { asked, read }
}

describe('walking a Claude transcript back for its last /model or /effort answer', () => {
  it('reads an /effort whose command ends one page and whose answer opens the next as one', async () => {
    // The answer row is the first row of the newest page; its envelope is the
    // last row of the page before.
    const file = [...replies(10), ...effortHigh(), ...replies(EFFORT_PROBE_PAGE - 1)]
    const { read, asked } = host(file)
    const outcome = await walkTranscriptForCommandPair(read)
    expect(outcome).toMatchObject({ kind: 'found', pair: { effort: 'high' } })
    expect(asked).toHaveLength(2)
  })

  it('stops at the page budget on a very long transcript instead of reading all of it', async () => {
    const file = [...effortHigh(), ...replies(EFFORT_PROBE_PAGE * (EFFORT_PROBE_MAX_PAGES + 2))]
    const { read, asked } = host(file)
    expect(await walkTranscriptForCommandPair(read)).toEqual({ kind: 'none', reason: 'page-budget-spent' })
    expect(asked).toHaveLength(EFFORT_PROBE_MAX_PAGES)
  })

  it('reads one page from an older host that ignores the cursor, and stops', async () => {
    const asked: ProbePageParams[] = []
    const read = async (params: ProbePageParams) => {
      asked.push(params)
      return { messages: replies(5) }
    }
    expect(await walkTranscriptForCommandPair(read)).toEqual({ kind: 'none', reason: 'searched-whole-transcript' })
    expect(asked).toHaveLength(1)
  })

  it('fails, naming why, on a reply with no message list or an error', async () => {
    expect(await walkTranscriptForCommandPair(async () => ({ error: 'Session file not found' }))).toEqual({
      kind: 'failed',
      reason: 'the host answered: Session file not found'
    })
    expect(await walkTranscriptForCommandPair(async () => null)).toMatchObject({ kind: 'failed' })
    expect(await walkTranscriptForCommandPair(async () => ({ messages: 'x' }))).toMatchObject({ kind: 'failed' })
    expect(
      await walkTranscriptForCommandPair(async () => {
        throw new Error('relay dropped')
      })
    ).toEqual({ kind: 'failed', reason: 'relay dropped' })
  })

  it('finds nothing in an empty transcript and in a one-row one', async () => {
    expect(await walkTranscriptForCommandPair(host([]).read)).toEqual({ kind: 'none', reason: 'searched-whole-transcript' })
    expect(await walkTranscriptForCommandPair(host(replies(1)).read)).toEqual({ kind: 'none', reason: 'searched-whole-transcript' })
  })

  it('does not take a prompt that only quotes the wording', async () => {
    const file = [row('user', '<local-command-stdout>Set effort level to max (this session only): x</local-command-stdout>'), ...replies(3)]
    expect(await walkTranscriptForCommandPair(host(file).read)).toMatchObject({ kind: 'none' })
  })
})
