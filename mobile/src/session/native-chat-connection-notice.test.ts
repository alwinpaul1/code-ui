import { describe, expect, it } from 'vitest'
import type { ConnectionVerdict } from '../transport/connection-health'
import type { ConnectionState } from '../transport/types'
import { nativeChatConnectionNotice, waitingText } from './native-chat-connection-notice'

// The Claude app's status row says what the live connection is doing while a turn runs
// (com.anthropic.claude 1.261009.20, `au8` case 0 over the strings `ccr_backplane_connecting`
// "Connecting…" and `ccr_backplane_connection_failed` "Connection lost"). It draws only while the
// row is busy, and a message state is drawn by `nl7.b` as the text with any trailing "..." and then
// any trailing "…" removed and an ASCII "..." put back (`u1x.B0` is removeSuffix).

const reaching: ConnectionState[] = ['connecting', 'handshaking', 'reconnecting']
const refused: ConnectionVerdict['kind'][] = ['warning', 'unreachable', 'auth-failed']

describe('the connection row while the agent works', () => {
  it.each(reaching)('says "Connecting..." while the phone is %s and has not given up', (connState) => {
    expect(nativeChatConnectionNotice({ connState, verdict: 'normal', agentWorking: true })).toEqual({
      kind: 'connecting',
      text: 'Connecting...'
    })
  })

  it.each(refused)('says "Connection lost..." once the phone\'s own verdict is %s', (verdict) => {
    expect(nativeChatConnectionNotice({ connState: 'reconnecting', verdict, agentWorking: true })).toEqual({
      kind: 'lost',
      text: 'Connection lost...'
    })
  })

  it('says "Connection lost..." for a socket that dropped and is not retrying, as the pairing failing does', () => {
    expect(nativeChatConnectionNotice({ connState: 'auth-failed', verdict: 'auth-failed', agentWorking: true })?.kind).toBe('lost')
    expect(nativeChatConnectionNotice({ connState: 'disconnected', verdict: 'unreachable', agentWorking: true })?.kind).toBe('lost')
  })

  it('draws nothing while the connection is up', () => {
    expect(nativeChatConnectionNotice({ connState: 'connected', verdict: 'normal', agentWorking: true })).toBeNull()
  })

  it('draws nothing when no turn is running: the row is the busy row, and the header already says the rest', () => {
    for (const connState of reaching) {
      expect(nativeChatConnectionNotice({ connState, verdict: 'normal', agentWorking: false })).toBeNull()
    }
    expect(nativeChatConnectionNotice({ connState: 'disconnected', verdict: 'unreachable', agentWorking: false })).toBeNull()
  })

  // 2026-10-15 12:29-12:31: the relay down, the turn still streaming from Anthropic. The chat's
  // connection is Anthropic's stream then, and the Claude app said no "Connection lost" over it.
  it('says nothing about the relay while the tab’s Anthropic stream is live', () => {
    expect(nativeChatConnectionNotice({ connState: 'disconnected', verdict: 'unreachable', agentWorking: true, anthropicLive: true })).toBeNull()
    expect(nativeChatConnectionNotice({ connState: 'reconnecting', verdict: 'normal', agentWorking: true, anthropicLive: true })).toBeNull()
    expect(nativeChatConnectionNotice({ connState: 'reconnecting', verdict: 'normal', agentWorking: true, anthropicLive: false })?.kind).toBe('connecting')
  })
})

describe('the words as the Claude app draws a message', () => {
  it('turns the string "Connecting…" into "Connecting..." and adds dots to "Connection lost"', () => {
    expect(waitingText('Connecting…')).toBe('Connecting...')
    expect(waitingText('Connection lost')).toBe('Connection lost...')
  })

  it('takes one trailing mark off, in the app\'s order: three dots first, then the ellipsis', () => {
    expect(waitingText('Connecting...')).toBe('Connecting...')
    expect(waitingText('Connecting…...')).toBe('Connecting...')
    expect(waitingText('')).toBe('...')
  })
})

// A Claude tab matched to its Anthropic session: the app's status line follows ITS stream, the
// backplane (1.261013.20: uq30.i maps the session's connecting state to "Connecting…",
// `ccr_backplane_connection_failed` "Connection lost"), and with the phone itself offline during a
// turn its footer says `chat_footer_polling_offline` verbatim (zr8.java:1097-1099). The relay to
// the desktop is not this line's to say.
describe('the status line on a Claude tab matched to its Anthropic session', () => {
  const relayUp = { connState: 'connected' as const, verdict: 'normal' as const }
  const relayDown = { connState: 'disconnected' as const, verdict: 'unreachable' as const }

  it.each(['idle', 'loading', 'reconnecting'] as const)('says "Connecting..." while the stream is %s, with the relay up', (phase) => {
    expect(nativeChatConnectionNotice({ ...relayUp, agentWorking: true, anthropic: { phase, turnOpen: true } })).toMatchObject({
      kind: 'connecting',
      text: 'Connecting...',
      anthropic: true
    })
  })

  it.each(['lost', 'error'] as const)('says "Connection lost..." once the stream is %s', (phase) => {
    expect(nativeChatConnectionNotice({ ...relayUp, agentWorking: true, anthropic: { phase, turnOpen: true } })).toMatchObject({
      kind: 'lost',
      text: 'Connection lost...'
    })
  })

  it('says nothing while the stream is live, whatever the relay is doing', () => {
    expect(nativeChatConnectionNotice({ ...relayDown, agentWorking: true, anthropic: { phase: 'live', turnOpen: true } })).toBeNull()
  })

  // With the relay down, the desktop cannot say the turn ended: the turn Anthropic last saw open
  // stands, as the app's line stays busy over a reconnect.
  it('a turn Anthropic last said was open counts as busy while the relay is down too', () => {
    expect(nativeChatConnectionNotice({ ...relayDown, agentWorking: false, anthropic: { phase: 'reconnecting', turnOpen: true } })?.kind).toBe('connecting')
  })

  // Review 2026-10-15: `turnOpen` is the last word of a stream that dropped mid-turn. With the relay
  // up, the desktop said the agent went idle, and "Connection lost..." with the working mark stayed
  // under a finished reply.
  it('stops saying the mid-turn "Connection lost..." once the desktop says the turn is over', () => {
    const notice = nativeChatConnectionNotice({ ...relayUp, agentWorking: false, anthropic: { phase: 'lost', turnOpen: true } })
    expect(notice?.text).not.toBe('Connection lost...')
    expect(nativeChatConnectionNotice({ ...relayUp, agentWorking: false, anthropic: { phase: 'reconnecting', turnOpen: true } })).toBeNull()
    expect(nativeChatConnectionNotice({ ...relayUp, agentWorking: false, anthropic: { phase: 'idle', turnOpen: true }, phoneOffline: true })).toBeNull()
  })

  it('an idle session draws no busy line while the stream connects', () => {
    expect(nativeChatConnectionNotice({ ...relayDown, agentWorking: false, anthropic: { phase: 'reconnecting', turnOpen: false }, phoneOffline: true })).toBeNull()
    expect(nativeChatConnectionNotice({ ...relayUp, agentWorking: false, anthropic: { phase: 'loading', turnOpen: false } })).toBeNull()
  })

  it('an idle session whose stream failed outright draws no line: the reason is a row under the chat', () => {
    expect(nativeChatConnectionNotice({ ...relayUp, agentWorking: false, anthropic: { phase: 'error', turnOpen: false } })).toBeNull()
  })

  it('the phone offline during a turn says the app’s sentence verbatim, no dots added', () => {
    expect(nativeChatConnectionNotice({ ...relayDown, agentWorking: true, anthropic: { phase: 'reconnecting', turnOpen: true }, phoneOffline: true })).toMatchObject({
      kind: 'offline',
      text: 'You’re offline. The rest of Claude’s reply will appear when you reconnect.'
    })
  })

  it('leaves an unmatched tab on the relay’s words, offline or not', () => {
    expect(nativeChatConnectionNotice({ ...relayDown, agentWorking: true, phoneOffline: true })?.kind).toBe('lost')
  })
})

// Review 2026-10-15: the branch took out the "Lost the connection to Anthropic" row, and on a
// matched tab the chat's rows come from that stream, so between turns they froze with nothing on
// screen saying so. A lost stream now always says the app's "Connection lost", quietly (no working
// mark, no dots) when no turn runs.
describe('a matched tab whose Anthropic stream is lost between turns', () => {
  const relayUp = { connState: 'connected' as const, verdict: 'normal' as const }
  const relayDown = { connState: 'disconnected' as const, verdict: 'unreachable' as const }
  const QUIET = { kind: 'lost', text: 'Connection lost', anthropic: true, quiet: true }

  it.each([
    ['the relay up, no turn open', { ...relayUp, agentWorking: false, anthropic: { phase: 'lost' as const, turnOpen: false } }],
    ['the relay up, a stale open turn', { ...relayUp, agentWorking: false, anthropic: { phase: 'lost' as const, turnOpen: true } }],
    ['the relay down, no turn open', { ...relayDown, agentWorking: false, anthropic: { phase: 'lost' as const, turnOpen: false } }],
    ['the phone offline, no turn open', { ...relayDown, agentWorking: false, anthropic: { phase: 'lost' as const, turnOpen: false }, phoneOffline: true }]
  ])('says a quiet "Connection lost" with %s', (_name, input) => {
    expect(nativeChatConnectionNotice(input)).toEqual(QUIET)
  })

  it('keeps the busy "Connection lost..." while the turn really runs', () => {
    expect(nativeChatConnectionNotice({ ...relayUp, agentWorking: true, anthropic: { phase: 'lost', turnOpen: true } })).toMatchObject({ kind: 'lost', text: 'Connection lost...' })
    expect(nativeChatConnectionNotice({ ...relayUp, agentWorking: true, anthropic: { phase: 'lost', turnOpen: true } })).not.toHaveProperty('quiet')
  })

  it('leaves an unmatched tab silent between turns', () => {
    expect(nativeChatConnectionNotice({ ...relayDown, agentWorking: false })).toBeNull()
  })
})
