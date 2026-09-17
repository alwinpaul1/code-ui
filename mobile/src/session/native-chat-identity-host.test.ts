import { describe, expect, it } from 'vitest'
import { encodeNativeChatTranscriptIdentity } from '../../../src/shared/native-chat-transcript-retention'
import { nativeChatIdentityHostId } from './native-chat-identity-host'

describe('reading the host out of a chat transcript identity', () => {
  it('reads the host the encoder actually wrote', () => {
    expect(nativeChatIdentityHostId(encodeNativeChatTranscriptIdentity(['host-1', 'wt-1']))).toBe(
      'host-1'
    )
  })

  // Failure path: a host lookup must degrade to "no host", never throw into the
  // chat tab. The first of these is the shape the old inline split assumed, and
  // it silently returned the whole string as if it were a host id.
  it.each([
    ['a NUL-delimited string, which nothing produces', `host-1${String.fromCharCode(0)}wt-1`],
    ['empty', ''],
    ['JSON that is not an array', '{"hostId":"host-1"}'],
    ['an array whose first entry is not a string', '[null,"wt-1"]'],
    ['an array whose host is empty', '["","wt-1"]']
  ])('returns undefined for %s', (_label, identity) => {
    expect(nativeChatIdentityHostId(identity)).toBeUndefined()
  })

  // Degenerate sizes: one part, and none.
  it('reads a one-part identity', () => {
    expect(nativeChatIdentityHostId(encodeNativeChatTranscriptIdentity(['host-1']))).toBe('host-1')
  })

  it('returns undefined for an empty identity array', () => {
    expect(nativeChatIdentityHostId(encodeNativeChatTranscriptIdentity([]))).toBeUndefined()
  })
})
