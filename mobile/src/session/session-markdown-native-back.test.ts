import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  addEventListener: vi.fn(() => ({ remove: () => {} })),
  dismiss: vi.fn()
}))

vi.mock('react-native', () => ({
  BackHandler: { addEventListener: native.addEventListener },
  Keyboard: { dismiss: () => native.dismiss() },
  Platform: { OS: 'android' }
}))
vi.mock('../platform/clipboard', () => ({
  useClipboardWriter: () => ({ writeText: async () => {} })
}))
vi.mock('../platform/haptics', () => ({ triggerSuccess: () => {}, triggerError: () => {} }))
vi.mock('./mobile-session-write-operations', () => ({ markdownTabSave: () => ({}) }))

import {
  useMobileSessionMarkdownActions,
  type MobileSessionMarkdownActionsScope
} from './use-mobile-session-markdown-actions'
import type { MarkdownDocState } from './mobile-session-route-types'

const router = { canGoBack: vi.fn(() => true), back: vi.fn(), replace: vi.fn() }

function scopeWith(markdownDocs: Map<string, MarkdownDocState>): MobileSessionMarkdownActionsScope {
  return {
    hostId: 'host-1',
    worktreeId: 'wt-1',
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hook calls only canGoBack/back/replace; any other member is a TypeError here.
    router: router as unknown as MobileSessionMarkdownActionsScope['router'],
    client: null,
    sessionTabs: [],
    markdownDocs,
    setMarkdownDocs: () => {},
    discardMarkdownTarget: null,
    setDiscardMarkdownTarget: () => {},
    setLeaveDrafts: () => {},
    markdownSaveSeqRef: { current: new Map() },
    markdownSaveInFlightRef: { current: new Set() },
    showToast: () => {},
    readMarkdownTab: async () => {}
  }
}

function dirtyDoc(): MarkdownDocState {
  return {
    status: 'ready',
    content: 'saved',
    localContent: 'edited',
    baseVersion: 'v1',
    isDirty: true,
    editable: true
  }
}

function Probe({ docs }: { docs: Map<string, MarkdownDocState> }): null {
  useMobileSessionMarkdownActions(scopeWith(docs))
  return null
}

beforeEach(() => {
  native.addEventListener.mockClear()
})

/**
 * Upstream #22362 claims the device key here natively as well, always. This fork does not: its
 * native key belongs to `use-mobile-session-view-switch.ts`, which shows the chat from a terminal
 * view and otherwise calls this hook's `requestLeaveSession`, so a dirty draft already gets the
 * prompt. A second claim, registered after it, would answer first and swallow the
 * terminal-to-chat Back.
 */
describe("the session's native Back with a Markdown draft", () => {
  it('leaves the key to the view switch, dirty draft or not', () => {
    act(() => {
      create(createElement(Probe, { docs: new Map([['tab-1', dirtyDoc()]]) }))
    })
    expect(native.addEventListener).not.toHaveBeenCalled()
  })
})
