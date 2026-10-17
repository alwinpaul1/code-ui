/**
 * Review of 2026-10-17: the session screen never told dictation which chat it was dictating into,
 * so every take used the first Anthropic account signed in on the phone. The session screen hands
 * the dictation hook the Claude chat's own account (the same one its artifacts are listed under,
 * useClaudeTabAccount); outside a Claude chat it hands nothing and the first account is used.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dictationChatAccount } from './dictation-chat-account'

const account = { tabId: 'tab-1', epoch: 1, agentSessionId: 'sess-1', configDir: '/Users/a/.claude-work' }

describe("the session screen names the chat's account to dictation", () => {
  it("names the Claude chat's own account", () => {
    expect(dictationChatAccount({ nativeChatClaudeArtifacts: { artifacts: [], account }, nativeChatArtifactAccountId: 'acct-nexdash' })).toEqual({ accountId: 'acct-nexdash' })
  })

  it('says a Claude chat has no known account when several are signed in and none is matched', () => {
    expect(dictationChatAccount({ nativeChatClaudeArtifacts: { artifacts: [], account }, nativeChatArtifactAccountId: null })).toEqual({ accountId: null })
    expect(dictationChatAccount({ nativeChatClaudeArtifacts: { artifacts: [], account } })).toEqual({ accountId: null })
  })

  it('names no chat outside a Claude chat (a terminal, a Codex chat)', () => {
    expect(dictationChatAccount({ nativeChatArtifactAccountId: null })).toBeUndefined()
  })

  it("the session dictation hook passes the chat's account into the Anthropic dictation hook", () => {
    const source = readFileSync(join(__dirname, 'use-mobile-session-native-chat-dictation.ts'), 'utf8')
    const call = /useAnthropicDictation\(\{([^}]*)\}\)/.exec(source)
    expect(call?.[1]).toMatch(/chatAccount:\s*dictationChatAccount\(nativeChatController\)/)
  })
})
