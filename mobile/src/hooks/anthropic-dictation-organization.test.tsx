/**
 * The Claude app opens voice_stream with the signed-in account's `organization_uuid`
 * (1.261013.20, r4u.java:1018). The phone's dictation must hand the stream the organization of the
 * account it dictates with, and still dictate when that account has no organization on record yet.
 */
import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => ({
  credential: null as null | { accessToken: string; organizationUuid?: string | null },
  options: [] as Record<string, unknown>[]
}))
vi.mock('../platform/dictation-capture', () => {
  const instance = {
    open: async () => ({ ok: true }),
    begin: () => true,
    end: async () => {},
    release: () => {},
    onChunk: () => ({ remove: () => {} })
  }
  return { useDictationCapture: () => instance }
})
vi.mock('../dictation/anthropic-credential-reader', () => ({
  fetchAnthropicCredential: async () => seen.credential
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

import { useAnthropicDictation, type UseAnthropicDictationResult } from './use-anthropic-dictation'

async function startTake(): Promise<UseAnthropicDictationResult> {
  const held: { result: UseAnthropicDictationResult | null } = { result: null }
  function Probe(): null {
    held.result = useAnthropicDictation({ enabled: true, onTranscript: () => {} })
    return null
  }
  await act(async () => {
    create(createElement(Probe))
  })
  await act(async () => {
    await held.result!.start()
  })
  return held.result!
}

beforeEach(() => {
  seen.options = []
})

describe('dictation names the account’s organization to voice_stream', () => {
  it('hands the stream the organization of the account it dictates with', async () => {
    seen.credential = { accessToken: 'tok', organizationUuid: 'org-1' }
    const hook = await startTake()
    expect(hook.isRecording).toBe(true)
    expect(seen.options).toEqual([expect.objectContaining({ accessToken: 'tok', organizationUuid: 'org-1' })])
  })

  it('still dictates when the account has no organization on record', async () => {
    seen.credential = { accessToken: 'tok', organizationUuid: null }
    const hook = await startTake()
    expect(hook.isRecording).toBe(true)
    expect(seen.options).toEqual([expect.objectContaining({ organizationUuid: null })])
  })

  // Reported 2026-10-16: the words above the composer were only corrected after the user stopped
  // talking; in the Claude app they correct while the user speaks. Probe p20 (three sentences with
  // 1.8 s pauses): with the app's parameter set the server's live text already read "if it it's"
  // at 9.1 s, while Claude Code's set read "if it is" until the final text at 19 s. The server took
  // linear16 audio, the OAuth token and the org with the app's set.
  it("dictates with the Claude app's voice_stream parameters, which correct the words while the user speaks", async () => {
    seen.credential = { accessToken: 'tok', organizationUuid: 'org-1' }
    await startTake()
    expect(seen.options).toEqual([expect.objectContaining({ protocol: 'claude-app' })])
  })
})
