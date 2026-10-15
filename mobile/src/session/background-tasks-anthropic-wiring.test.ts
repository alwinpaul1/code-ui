// The Background tasks sheet reads Anthropic's list only if two hand-offs are made, neither of
// which any render test of the sheet crosses: the chat controller puts the matched session's
// events on the chat's live state, and the tab's tasks provider hands the sheet its transcript
// page. Both are wiring with no behaviour of their own to drive, so their source is read (CLAUDE.md
// item 6), matching code, not the comments above it.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CCR_IDLE_LIVE_STATE } from './ccr-live-state'
import { claudeChatLive } from './claude-chat-live'

const code = (file: string) =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
    .split('\n')
    .filter((line: string) => !/^\s*(\/\/|\/?\*)/.test(line))
    .join('\n')

const STREAM = { events: [], accountId: 'acct', sessionId: 'session_01' }

describe("the sheet is handed Anthropic's stream only while it is live", () => {
  it('carries the stream on the live state while the link is live, and nothing otherwise', () => {
    const base = { live: CCR_IDLE_LIVE_STATE, connectionStatus: null, relayConnected: true, stream: STREAM }
    expect(claudeChatLive({ ...base, linkPhase: 'live' })?.stream).toBe(STREAM)
    expect(claudeChatLive({ ...base, linkPhase: 'lost' })?.stream).toBeNull()
    expect(claudeChatLive({ ...base, linkPhase: 'live', stream: null })?.stream).toBeNull()
  })

  it("the controller puts the matched session's events on the chat's live state", () => {
    expect(code('use-mobile-native-chat-controller.ts')).toMatch(
      /claudeChatLive\(\{[^}]*stream: claudeApi\.gate\.kind === 'matched' \? \{ events: claudeApi\.events, accountId: claudeApi\.gate\.accountId, sessionId: claudeApi\.gate\.sessionId \} : null/
    )
  })

  it('the tasks provider hands the sheet its transcript page', () => {
    const provider = code('MobileNativeChatTasksProvider.tsx')
    const sheet = provider.slice(provider.indexOf('<MobileBackgroundTasksSheet'), provider.indexOf('/>', provider.indexOf('<MobileBackgroundTasksSheet')))
    expect(sheet).toContain('transcriptPage={BACKGROUND_TASK_TRANSCRIPT_PAGE}')
  })
})
