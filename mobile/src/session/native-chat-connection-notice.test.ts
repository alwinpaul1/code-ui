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
