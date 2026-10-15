import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-secure-store', () => ({ setItemAsync: vi.fn(), getItemAsync: vi.fn(async () => null), deleteItemAsync: vi.fn() }))

import { setCcrMapping, resetCcrCacheForTests, bindCcrConfigDir, type CcrSendTarget } from './ccr-session-cache'
import { ccrSessionFactsForTab, noteCcrSessionFacts, resetCcrSessionFactsForTests } from './ccr-session-facts'
import { parseCcrSessionRow } from './ccr-session-row'
import { useCcrSessionHeader } from './use-ccr-session-header'

// The Claude app marks a session read when it is opened (`POST …/mark_read`, drv.java:3099), so
// other clients' Unread marks clear. The phone does the same for a matched Claude chat, but only
// with CCR_SESSION_WRITES on: the endpoint is unproven with the phone's token. Off, nothing is sent.
const SESSION = 'cse_01QXaaaaaaaaaaaaaaaaaaaa'
const ACCOUNT = 'acct-1'
const DIR = '/Users/me/.claude'

let renderer: ReactTestRenderer | null = null
const calls: { target: CcrSendTarget; eventId: string | null }[] = []
let answer = true

function Probe(props: { writesOn: boolean; newestEventId: string | null }) {
  useCcrSessionHeader({
    enabled: true,
    tabId: 'tab-1',
    epoch: 1,
    configDir: DIR,
    newestEventId: props.newestEventId,
    writesOn: props.writesOn,
    markRead: async (target, eventId) => {
      calls.push({ target, eventId })
      return answer
    }
  })
  return null
}

async function mount(writesOn: boolean, unread: boolean | null, newestEventId: string | null = 'evt_9') {
  noteCcrSessionFacts('tab-1', 1, parseCcrSessionRow({ id: SESSION, title: 'T', unread })!)
  await act(async () => {
    renderer = create(createElement(Probe, { writesOn, newestEventId }))
  })
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  resetCcrCacheForTests()
  resetCcrSessionFactsForTests()
  bindCcrConfigDir(DIR, ACCOUNT)
  setCcrMapping('tab-1', SESSION, 1, ACCOUNT, null, DIR)
  calls.length = 0
  answer = true
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('opening an unread Claude session', () => {
  it('sends nothing while the session writes switch is off', async () => {
    await mount(false, true)
    expect(calls).toEqual([])
    expect(ccrSessionFactsForTab('tab-1', SESSION)?.unread).toBe(true)
  })

  it('marks it read once, up to the newest event, with the switch on', async () => {
    await mount(true, true)
    expect(calls).toEqual([{ target: { kind: 'target', sessionId: SESSION, accountId: ACCOUNT }, eventId: 'evt_9' }])
    expect(ccrSessionFactsForTab('tab-1', SESSION)?.unread).toBe(false)
    await act(async () => {
      renderer!.update(createElement(Probe, { writesOn: true, newestEventId: 'evt_10' }))
    })
    expect(calls).toHaveLength(1)
  })

  it('keeps the Unread mark when Anthropic refuses the mark', async () => {
    answer = false
    await mount(true, true)
    expect(calls).toHaveLength(1)
    expect(ccrSessionFactsForTab('tab-1', SESSION)?.unread).toBe(true)
  })

  it('sends nothing for a session already read, or one whose row does not say', async () => {
    await mount(true, false)
    act(() => renderer?.unmount())
    await mount(true, null)
    expect(calls).toEqual([])
  })
})
