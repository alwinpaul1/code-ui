import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// STRUCTURE, not behaviour: which value each pill reads. A source test is the
// only instrument for "the composer's sheet and the header pill read the SAME
// fallback", because a render of the controller would need the whole chat
// stack. Comments are stripped first so prose cannot satisfy the match.
const code = (file: string) =>
  readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the model pills read the fallback with the session command pair laid over it', () => {
  it('feeds the chat rows and the beacon time to the fallback hook, which every pill reads', () => {
    const controller = code('./use-mobile-native-chat-controller.ts')
    expect(controller).toMatch(/useClaudeTranscriptModel\(\{[^}]*messages: nativeChatSession\.messages[,} ]/)
    // And what the screen poll read of the spinner's effort and an alt+p toast
    // (claude-screen-model-pair.ts), from the same HUD the pills read.
    expect(controller).toMatch(/useClaudeTranscriptModel\(\{[^}]*screenStatement: screenModelStatement \}\)/)
    expect(controller).toMatch(/modelStatement: screenModelStatement\s*\} = useMobileNativeChatHud\(/)
    // The liveness-checked beacon's time, never the stored one's: a written-off
    // beacon timed a /model row over the badge for good (review, 2026-10-09).
    expect(controller).toMatch(/beaconHandle: activeHandle, beaconStoredAt: [^,]*hudLiveBeacon\?\.receivedAt/)
    expect(controller).not.toMatch(/beaconStoredAt: [^,]*hudBeacon\?\./)
    expect(controller).toMatch(/liveEffort: claudeLive\.effort/)
    expect(controller).toMatch(/liveModel: claudeLive\.model/)
  })
  it('reads the pill from the live pair with a newer model command laid over it', () => {
    const controller = code('./use-mobile-native-chat-controller.ts')
    expect(controller).toMatch(/const claudeReported = claudeReportedOverLive\(claudeLive, transcriptModel\.fallback\)/)
    expect(controller).not.toMatch(/const claudeReported = reportedModelPair/)
  })
  it('lays the pair over the resolved fallback, and a newer command over a beacon, never over a live pair otherwise', () => {
    const hook = code('./use-claude-transcript-model.ts')
    expect(hook).toMatch(/withSessionCommandPair\(base, command\)/)
    expect(hook).toMatch(/enabled && sessionId && messages \? sessionCommandPairFor\(/)
    expect(hook).toMatch(/pick && base\.kind === 'none'/)
    expect(hook).toMatch(/: commandOverBeacon\(command, liveModel, heardAt, liveEffort \?\? null\)/)
  })
  it('lets the composer sheet draw the effort the fallback carries', () => {
    expect(code('./use-mobile-native-chat-session-option-controller.ts')).toMatch(
      /effort: transcriptModel\.effort \?\? null/
    )
  })
})
