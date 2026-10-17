/**
 * Review of 2026-10-17: dictation always read the first account signed in on the phone
 * (fetchAnthropicCredential), whatever chat it was dictating into. With Account 1 and NexDash both
 * signed in, a take in a NexDash chat went to voice_stream with Account 1's token and Account 1's
 * `organization_uuid`. A take in a chat dictates with that chat's own account; a chat whose
 * account is not known (several signed in, none matched) uses the first one and says so once; a
 * chat whose account cannot give a token refuses with the reason rather than using another one.
 */
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountCredential } from '../dictation/anthropic-credential-reader'

const seen = vi.hoisted(() => ({
  primary: null as null | { accessToken: string; organizationUuid?: string | null },
  accounts: [] as AccountCredential[],
  accountsError: null as Error | null,
  asked: [] as (string | undefined)[],
  primaryReads: 0,
  options: [] as Record<string, unknown>[],
  micOpens: 0
}))
vi.mock('../platform/dictation-capture', () => {
  const instance = {
    open: async () => {
      seen.micOpens += 1
      return { ok: true }
    },
    begin: () => true,
    end: async () => {},
    release: () => {},
    onChunk: () => ({ remove: () => {} })
  }
  return { useDictationCapture: () => instance }
})
vi.mock('../dictation/anthropic-credential-reader', () => ({
  fetchAnthropicCredential: async () => {
    seen.primaryReads += 1
    return seen.primary
  },
  fetchAccountCredentials: async (only?: string) => {
    seen.asked.push(only)
    if (seen.accountsError) {
      throw seen.accountsError
    }
    return seen.accounts.filter((account) => only === undefined || account.id === only)
  }
}))
vi.mock('../dictation/anthropic-voice-stream', () => ({
  AnthropicVoiceStream: class {
    constructor(options: Record<string, unknown>) {
      seen.options.push(options)
    }
    connect(): void {}
    sendAudio(): void {}
    finalize(): Promise<void> {
      return Promise.resolve()
    }
    destroy(): void {}
  }
}))

import { useAnthropicDictation, type DictationChatAccount, type UseAnthropicDictationResult } from './use-anthropic-dictation'

const ACCOUNT_1: AccountCredential = { id: 'acct-1', label: 'Account 1', accessToken: 'tok-1', organizationUuid: 'org-1' }
const NEXDASH: AccountCredential = { id: 'acct-nexdash', label: 'NexDash', accessToken: 'tok-nexdash', organizationUuid: 'org-nexdash' }

async function startTake(chatAccount: DictationChatAccount | undefined): Promise<{ hook: UseAnthropicDictationResult; errors: Error[] }> {
  const held: { result: UseAnthropicDictationResult | null } = { result: null }
  const errors: Error[] = []
  function Probe(): null {
    held.result = useAnthropicDictation({ enabled: true, onTranscript: () => {}, onError: (err) => errors.push(err), chatAccount })
    return null
  }
  await act(async () => {
    create(createElement(Probe))
  })
  await act(async () => {
    await held.result!.start()
  })
  return { hook: held.result!, errors }
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  seen.primary = { accessToken: ACCOUNT_1.accessToken!, organizationUuid: ACCOUNT_1.organizationUuid }
  seen.accounts = [ACCOUNT_1, NEXDASH]
  seen.accountsError = null
  seen.asked = []
  seen.primaryReads = 0
  seen.options = []
  seen.micOpens = 0
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
})

describe("dictation in a chat uses the chat's own Anthropic account", () => {
  it("dictates with the chat's own account, not the first one signed in", async () => {
    const { hook } = await startTake({ accountId: NEXDASH.id })
    expect(hook.isRecording).toBe(true)
    expect(seen.asked).toEqual([NEXDASH.id])
    expect(seen.options).toEqual([expect.objectContaining({ accessToken: 'tok-nexdash', organizationUuid: 'org-nexdash' })])
    expect(warn).not.toHaveBeenCalled()
  })

  it("falls back to the first account signed in when the chat's account is not known, and warns once that it did", async () => {
    const { hook } = await startTake({ accountId: null })
    expect(hook.isRecording).toBe(true)
    expect(seen.options).toEqual([expect.objectContaining({ accessToken: 'tok-1', organizationUuid: 'org-1' })])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/chat's Anthropic account is not known.*first account signed in/)
  })

  it('outside a chat, dictates with the first account signed in and warns about nothing', async () => {
    const { hook } = await startTake(undefined)
    expect(hook.isRecording).toBe(true)
    expect(seen.asked).toEqual([])
    expect(seen.options).toEqual([expect.objectContaining({ accessToken: 'tok-1', organizationUuid: 'org-1' })])
    expect(warn).not.toHaveBeenCalled()
  })

  it("refuses with the reason when the chat's account has no live token, rather than dictating with another account", async () => {
    seen.accounts = [ACCOUNT_1, { ...NEXDASH, accessToken: null, error: 'the sign-in expired and could not be refreshed; sign in to this account again in Settings, Anthropic accounts' }]
    const { hook, errors } = await startTake({ accountId: NEXDASH.id })
    expect(hook.status).toBe('error')
    expect(hook.error).toBe("Can't dictate with NexDash, this chat's account: the sign-in expired and could not be refreshed; sign in to this account again in Settings, Anthropic accounts")
    expect(errors.map((err) => err.message)).toEqual([hook.error])
    expect(seen.options).toEqual([])
    expect(seen.micOpens).toBe(0)
    expect(seen.primaryReads).toBe(1) // the mount's availability read only, never the take
  })

  it("refuses with the reason when the chat's account is no longer signed in on the phone", async () => {
    seen.accounts = [ACCOUNT_1]
    const { hook } = await startTake({ accountId: NEXDASH.id })
    expect(hook.status).toBe('error')
    expect(hook.error).toBe("This chat's Anthropic account is no longer signed in on the phone. Sign in to it again in Settings, Anthropic accounts, to dictate here")
    expect(seen.options).toEqual([])
    expect(seen.micOpens).toBe(0)
  })

  it("refuses with the reason when the chat's account cannot be read at all", async () => {
    seen.accountsError = new Error('SecureStore unavailable')
    const { hook } = await startTake({ accountId: NEXDASH.id })
    expect(hook.status).toBe('error')
    expect(hook.error).toBe("Can't read this chat's Anthropic account to dictate: SecureStore unavailable")
    expect(seen.options).toEqual([])
    expect(seen.micOpens).toBe(0)
  })
})
