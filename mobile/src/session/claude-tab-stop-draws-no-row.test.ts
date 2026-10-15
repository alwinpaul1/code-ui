import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NATIVE_CHAT_INTERRUPTED_STATUS_TEXT, type NativeChatMessage } from '../../../src/shared/native-chat-types'
import { buildMobileNativeChatTransientData, foldMobileNativeChatMessages } from './mobile-native-chat-render-data'

// A Claude tab that is not matched to an Anthropic session reads Orca's
// transcript, whose decoder turns Claude Code's `[Request interrupted by
// user]` record into a status row, and the chat drew it as a red "Session
// interrupted" after every Stop. The Claude app (1.261013.20) draws nothing for
// a Stop: the marker becomes no row (`u5a.j`, `t5v`) and its `result` row draws
// nothing (`gy30`), which a matched tab already does (542b5935e). Codex keeps
// its row: the Claude app has no Codex screen to copy.

const user = (id: string, text: string): NativeChatMessage => ({ id, role: 'user', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' })
const assistant = (id: string, text: string): NativeChatMessage => ({ id, role: 'assistant', blocks: [{ type: 'text', text }], timestamp: 0, source: 'transcript' })
/** Orca's row for a stopped turn, from Claude Code's interrupt record and from Codex's `turn_aborted` alike. */
const stopped = (id: string): NativeChatMessage => ({
  id,
  role: 'system',
  blocks: [{ type: 'text', text: NATIVE_CHAT_INTERRUPTED_STATUS_TEXT }],
  timestamp: 0,
  source: 'transcript'
})

function drawn(
  messages: NativeChatMessage[],
  agent: string | null,
  pending: Parameters<typeof buildMobileNativeChatTransientData>[0]['pending'] = []
): string[] {
  return buildMobileNativeChatTransientData({
    messages,
    folded: foldMobileNativeChatMessages(messages),
    streaming: null,
    pending,
    agent
  }).data.map((message) => message.id)
}

const STOPPED_TURN = [user('u1', 'go'), assistant('a1', 'Looking.'), stopped('s1'), user('u2', 'again')]

describe('a stopped turn on a Claude tab Orca reads', () => {
  it('draws no row for the Stop, as the Claude app draws none', () => {
    expect(drawn(STOPPED_TURN, 'claude')).toEqual(['u1', 'a1', 'u2'])
  })

  it('draws nothing at all for a transcript that is only the Stop', () => {
    expect(drawn([stopped('s1')], 'claude')).toEqual([])
  })

  it('keeps a message sent right after the Stop where it was sent', () => {
    expect(drawn([user('u1', 'go'), assistant('a1', 'Looking.'), stopped('s1')], 'claude', [
      { id: 'p1', text: 'next', drawAfterId: 's1' }
    ])).toEqual(['u1', 'a1', 'p1'])
  })
})

describe('a stopped turn on a Codex tab', () => {
  it('keeps its Session interrupted row', () => {
    expect(drawn(STOPPED_TURN, 'codex')).toEqual(['u1', 'a1', 's1', 'u2'])
  })

  it('keeps it where the agent is not known either', () => {
    expect(drawn(STOPPED_TURN, null)).toEqual(['u1', 'a1', 's1', 'u2'])
  })
})

// The list is built in the chat view; the rule only holds if the view hands
// it the tab's agent. Matched against code, not the comments around it.
describe('the chat view', () => {
  it("passes the tab's agent to the list it builds", () => {
    const source = readFileSync(join(import.meta.dirname, 'MobileNativeChatView.tsx'), 'utf8')
    const call = source.match(/buildMobileNativeChatTransientData\(\{([^}]*)\}\)/)
    expect(call?.[1]).toMatch(/\bagent\b/)
  })
})
