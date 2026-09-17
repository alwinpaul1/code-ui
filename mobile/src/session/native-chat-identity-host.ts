/**
 * The host id inside a native-chat transcript identity.
 *
 * `sourceIdentity` is built by `encodeNativeChatTranscriptIdentity([hostId,
 * worktreeId])`, which is `JSON.stringify(parts)`. It is JSON, not a delimited
 * string, and it is vendored so its shape is not ours to change.
 *
 * Why this exists rather than an inline split: a caller open-coded a `\0` split
 * against it, got the whole JSON string back, and `useLastConnectedAt` then
 * matched no host at all. The reconnect refetch was dead while the release notes
 * said it worked, and the unit test passed because it fed the hook the same
 * invented string instead of the encoder's real output.
 *
 * Returns undefined rather than throwing: a caller passes this straight to a
 * host lookup, and an unreadable identity should read as "no host", never crash
 * the chat tab.
 */
export function nativeChatIdentityHostId(sourceIdentity: string): string | undefined {
  try {
    const parts: unknown = JSON.parse(sourceIdentity)
    if (!Array.isArray(parts)) {
      return undefined
    }
    const [hostId] = parts as unknown[]
    return typeof hostId === 'string' && hostId !== '' ? hostId : undefined
  } catch {
    return undefined
  }
}
