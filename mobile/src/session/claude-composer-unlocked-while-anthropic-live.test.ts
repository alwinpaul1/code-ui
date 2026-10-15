/**
 * Parity audit 2026-10-15, gap 1: with the relay to the desktop down, a Claude tab matched to its
 * Remote Control session read "Reconnecting…" and its composer was locked by the terminal's input
 * lease, while the header already said Anthropic's "Connected" and the send lane (a POST into the
 * session) needed no terminal at all. The Claude app refuses a send only on its own conditions
 * (offline, a send in flight, empty). So the lease lock is lifted while that lane is live.
 */
import { describe, expect, it } from 'vitest'
import { composerPlaceholder, nativeChatComposerLockReason } from './use-mobile-native-chat-input-lock'

describe('the composer of a Claude tab whose Anthropic lane is live', () => {
  it('is not locked "Reconnecting…" by the terminal lease while the relay is down', () => {
    const lock = nativeChatComposerLockReason({ agentSessionTab: false, relayConnected: false, leaseLock: 'disconnected', anthropicLaneLive: true })
    expect(lock).toBeNull()
    expect(composerPlaceholder(lock, false)).toBe('Type / for commands')
  })

  it('is not held at "Waiting for terminal…" before the lease is acknowledged', () => {
    expect(nativeChatComposerLockReason({ agentSessionTab: false, relayConnected: true, leaseLock: 'waiting', anthropicLaneLive: true })).toBeNull()
  })

  it('keeps the lease lock when the lane is not live (reconnecting, lost, unmatched, offline)', () => {
    expect(nativeChatComposerLockReason({ agentSessionTab: false, relayConnected: false, leaseLock: 'disconnected', anthropicLaneLive: false })).toBe('disconnected')
    expect(nativeChatComposerLockReason({ agentSessionTab: false, relayConnected: true, leaseLock: 'waiting', anthropicLaneLive: false })).toBe('waiting')
    expect(nativeChatComposerLockReason({ agentSessionTab: false, relayConnected: true, leaseLock: null, anthropicLaneLive: false })).toBeNull()
  })

  it('leaves an agent-session tab on the relay alone, as before', () => {
    expect(nativeChatComposerLockReason({ agentSessionTab: true, relayConnected: false, leaseLock: null, anthropicLaneLive: true })).toBe('disconnected')
    expect(nativeChatComposerLockReason({ agentSessionTab: true, relayConnected: true, leaseLock: 'waiting', anthropicLaneLive: false })).toBeNull()
  })
})
