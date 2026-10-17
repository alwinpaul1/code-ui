/**
 * Review of 2026-10-17: the session screen never told dictation which chat it was dictating into,
 * so every take used the first Anthropic account signed in on the phone. The session screen hands
 * the dictation hook the Claude chat's own account (the same one its artifacts are listed under,
 * useClaudeTabAccount); outside a Claude chat it hands nothing and the first account is used.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { dictationChatAccount } from './dictation-chat-account'
import type { MobileNativeChatController } from './mobile-native-chat-controller-contract'

const account = { tabId: 'tab-1', epoch: 1, agentSessionId: 'sess-1', configDir: '/Users/a/.claude-work' }

describe("the session screen names the chat's account to dictation", () => {
  // The artifacts' account falls back to the only account signed in, which is not proof the session
  // is its own ("it must exactly tell", 2026-10-17): dictation always asks the lookup, which takes a
  // kept match or config-dir binding first and otherwise asks Anthropic.
  it("asks the lookup even when the chat's artifacts name the only account signed in", async () => {
    const lookUp = vi.fn(async () => ({ ok: true as const, accountId: 'acct-only' }))
    const chat = dictationChatAccount({ nativeChatClaudeArtifacts: { artifacts: [], account }, nativeChatArtifactAccountId: 'acct-only' }, lookUp)
    expect(chat?.accountId).toBeNull()
    await chat?.resolve?.()
    expect(lookUp).toHaveBeenCalledTimes(1)
  })

  it("hands a Claude chat with no matched account a lookup of the tab's own session, with its transcript messages", async () => {
    const messages = [
      { id: 'm-1', source: 'transcript', timestamp: 1000 },
      { id: 'local-1', source: 'local', timestamp: 3000 },
      { id: 'm-2', source: 'transcript', timestamp: 2000 }
    ] as unknown as MobileNativeChatController['nativeChatSession']['messages']
    const lookUp = vi.fn(async () => ({ ok: true as const, accountId: 'acct-nexdash' }))
    const chat = dictationChatAccount(
      { nativeChatClaudeArtifacts: { artifacts: [], account }, nativeChatArtifactAccountId: null, nativeChatSession: { messages } as MobileNativeChatController['nativeChatSession'] },
      lookUp
    )
    expect(chat?.accountId).toBeNull()
    await expect(chat?.resolve?.()).resolves.toEqual({ ok: true, accountId: 'acct-nexdash' })
    expect(lookUp).toHaveBeenCalledWith(account, { messageIds: ['m-1', 'm-2'], newestMessageAt: 2000 })
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
