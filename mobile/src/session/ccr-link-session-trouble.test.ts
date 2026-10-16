import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { CcrLinkState, CcrSessionLink } from './ccr-session-link'
import { ccrLinkSession } from './use-claude-anthropic-transcript'

// A lost stream is the status line's to say on a matched Claude tab ("Connection lost...", or the
// phone-offline sentence; native-chat-connection-notice.ts), as the Claude app says it there and
// nowhere else. Code UI also put a warning row at the END of the conversation ("Lost the connection
// to Anthropic. It reconnects when the phone is back online."), which the app has no equivalent
// of: it stayed under the newest reply until the stream came back.

const link = { sessionId: 'cse_1', loadOlder: async () => undefined } as unknown as CcrSessionLink
const LOST = 'Lost the connection to Anthropic. It reconnects when the phone is back online.'
const state = (over: Partial<CcrLinkState>): CcrLinkState => ({
  events: [],
  phase: 'live',
  error: null,
  hasOlder: false,
  loadingOlder: false,
  connectionStatus: null,
  liveFrom: 0,
  version: 1,
  ...over
})
const reply = (id: string): NativeChatMessage => ({ id, role: 'assistant', blocks: [{ type: 'text', text: 'done' }], timestamp: null, source: 'transcript' })

describe('a lost Anthropic stream on a chat with rows', () => {
  it('draws no warning row at the end of the conversation: the status line says it', () => {
    const session = ccrLinkSession(link, state({ phase: 'lost', error: LOST }), [reply('r1')])
    expect(session.messages.map((message) => message.id)).toEqual(['r1'])
    expect(session.status).toBe('ready')
  })

  it('keeps the rows and their order with one row, the degenerate list', () => {
    expect(ccrLinkSession(link, state({ phase: 'lost', error: LOST }), [reply('only')]).messages).toHaveLength(1)
  })

  it('still says why in the empty state when there is nothing to show', () => {
    const session = ccrLinkSession(link, state({ phase: 'lost', error: LOST }), [])
    expect(session).toMatchObject({ status: 'error', error: LOST, messages: [] })
  })

  it('a stream that failed outright (not a dropped connection) keeps its reason under the rows', () => {
    const session = ccrLinkSession(link, state({ phase: 'error', error: 'Anthropic refused the session.' }), [reply('r1')])
    expect(session.messages.map((message) => message.id)).toEqual(['r1', 'ccr-link-trouble:cse_1'])
  })
})
