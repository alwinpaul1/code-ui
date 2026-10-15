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

  it('a turn Anthropic last said was open counts as busy when the relay says idle', () => {
    expect(nativeChatConnectionNotice({ ...relayUp, agentWorking: false, anthropic: { phase: 'reconnecting', turnOpen: true } })?.kind).toBe('connecting')
  })

  it('an idle session draws nothing, connecting or not', () => {
    expect(nativeChatConnectionNotice({ ...relayDown, agentWorking: false, anthropic: { phase: 'lost', turnOpen: false } })).toBeNull()
    expect(nativeChatConnectionNotice({ ...relayDown, agentWorking: false, anthropic: { phase: 'reconnecting', turnOpen: false }, phoneOffline: true })).toBeNull()
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
