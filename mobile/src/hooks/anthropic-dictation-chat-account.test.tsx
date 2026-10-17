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
  micOpens: 0,
  micReleases: 0
}))
vi.mock('../platform/dictation-capture', () => {
  const instance = {
    open: async () => {
      seen.micOpens += 1
      return { ok: true }
    },
    begin: () => true,
    end: async () => {},
    release: () => {
      seen.micReleases += 1
    },
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

import { UNKNOWN_SESSION_ACCOUNT, useAnthropicDictation, type DictationChatAccount, type UseAnthropicDictationResult } from './use-anthropic-dictation'

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
  seen.micReleases = 0
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

  // The user, 2026-10-17: "for dictation use the account or profile that sessions exactly belongs
  // to". A session whose account is not known is never dictated with another one.
  it("refuses, rather than dictating with the first account, when the chat's account is not known", async () => {
    const { hook, errors } = await startTake({ accountId: null })
    expect(hook.status).toBe('error')
    expect(hook.error).toBe(UNKNOWN_SESSION_ACCOUNT)
    expect(errors.map((err) => err.message)).toEqual([UNKNOWN_SESSION_ACCOUNT])
    expect(seen.options).toEqual([])
    expect(seen.micReleases).toBe(1) // opened at the tap (first-words fix), let go on the refusal
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/not known.*nobody else's account/)
  })

  // "it must exactly tell" (the user, 2026-10-17): a chat whose account is not matched yet is
  // matched on demand (session/dictation-session-account.ts) before the microphone opens.
  it("matches the chat's account on demand and dictates with it when it was not known at the tap", async () => {
    const resolve = vi.fn(async () => ({ ok: true as const, accountId: NEXDASH.id }))
    const { hook } = await startTake({ accountId: null, resolve })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(hook.isRecording).toBe(true)
    expect(seen.asked).toEqual([NEXDASH.id])
    expect(seen.options).toEqual([expect.objectContaining({ accessToken: 'tok-nexdash', organizationUuid: 'org-nexdash' })])
    expect(warn).not.toHaveBeenCalled()
  })

  it("refuses with the lookup's own reason, and one log line naming it, when the account cannot be found", async () => {
    const reason = "This session belongs to an Anthropic account that isn't signed in on the phone: none of the 2 signed in holds it (…). Sign in to that account in Settings, Anthropic accounts, to dictate here."
    const { hook, errors } = await startTake({ accountId: null, resolve: async () => ({ ok: false, reason }) })
    expect(hook.status).toBe('error')
    expect(hook.error).toBe(reason)
    expect(errors.map((err) => err.message)).toEqual([reason])
    expect(seen.options).toEqual([])
    expect(seen.micReleases).toBe(1) // opened at the tap (first-words fix), let go on the refusal
    expect(seen.asked).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toBe(`[dictation] refused: this session's Anthropic account could not be found exactly: ${reason}`)
  })

  it('refuses with the reason when the lookup itself throws, never with another account', async () => {
    const { hook } = await startTake({ accountId: null, resolve: () => Promise.reject(new Error('chunk failed to load')) })
    expect(hook.status).toBe('error')
    expect(hook.error).toBe("Can't tell which Anthropic account this session belongs to: chunk failed to load")
    expect(seen.options).toEqual([])
    expect(seen.micReleases).toBe(1) // opened at the tap (first-words fix), let go on the refusal
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('makes no stream and lets the microphone go when the take is cancelled while its account is being looked up', async () => {
    let answer: (value: { ok: true; accountId: string }) => void = () => {}
    const resolve = () => new Promise<{ ok: true; accountId: string }>((done) => { answer = done })
    const held: { result: UseAnthropicDictationResult | null } = { result: null }
    function Probe(): null {
      held.result = useAnthropicDictation({ enabled: true, onTranscript: () => {}, chatAccount: { accountId: null, resolve } })
      return null
    }
    await act(async () => {
      create(createElement(Probe))
    })
    let started: Promise<void> = Promise.resolve()
    await act(async () => {
      started = held.result!.start()
    })
    await act(async () => {
      await held.result!.cancel()
    })
    await act(async () => {
      answer({ ok: true, accountId: NEXDASH.id })
      await started
    })
    expect(seen.micReleases).toBe(1) // opened at the tap (first-words fix), let go on the refusal
    expect(seen.options).toEqual([])
    expect(held.result!.status).toBe('idle')
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
    expect(seen.micReleases).toBe(1) // opened at the tap (first-words fix), let go on the refusal
    expect(seen.primaryReads).toBe(1) // the mount's availability read only, never the take
  })

  it("refuses with the reason when the chat's account is no longer signed in on the phone", async () => {
    seen.accounts = [ACCOUNT_1]
    const { hook } = await startTake({ accountId: NEXDASH.id })
    expect(hook.status).toBe('error')
    expect(hook.error).toBe("This chat's Anthropic account is no longer signed in on the phone. Sign in to it again in Settings, Anthropic accounts, to dictate here")
    expect(seen.options).toEqual([])
    expect(seen.micReleases).toBe(1) // opened at the tap (first-words fix), let go on the refusal
  })

  it("refuses with the reason when the chat's account cannot be read at all", async () => {
    seen.accountsError = new Error('SecureStore unavailable')
    const { hook } = await startTake({ accountId: NEXDASH.id })
    expect(hook.status).toBe('error')
    expect(hook.error).toBe("Can't read this chat's Anthropic account to dictate: SecureStore unavailable")
    expect(seen.options).toEqual([])
    expect(seen.micReleases).toBe(1) // opened at the tap (first-words fix), let go on the refusal
  })
})
