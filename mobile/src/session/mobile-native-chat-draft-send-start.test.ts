import { describe, expect, it, vi } from 'vitest'
import { clearDraftAtSendStartWith } from './mobile-native-chat-draft-send-start'
import type { MobileNativeChatSendOrigin } from './mobile-native-chat-pending-echo'

const ORIGIN: MobileNativeChatSendOrigin = {
  draftKey: 'k',
  draftEditGeneration: 0,
  pendingKey: 'p',
  normalizedText: 'hi',
  baselineOccurrences: 0,
  baselineTailMessageId: null,
  baselineResolved: true
}

function drafts(overrides: Partial<Parameters<typeof clearDraftAtSendStartWith>[0]> = {}) {
  return {
    captureSendOrigin: vi.fn(() => ORIGIN),
    clearDraftForSend: vi.fn(),
    restoreRejectedDraft: vi.fn(),
    acceptSend: vi.fn(() => 'pending-1'),
    removePending: vi.fn(),
    ...overrides
  }
}

describe('clearDraftAtSendStartWith', () => {
  it('clears the draft but adds no bubble when the send carries no images', () => {
    const deps = drafts()

    const undo = clearDraftAtSendStartWith(deps, 'hi')

    expect(deps.clearDraftForSend).toHaveBeenCalledWith(ORIGIN, 'hi')
    expect(deps.acceptSend).not.toHaveBeenCalled()
    undo?.()
    expect(deps.restoreRejectedDraft).toHaveBeenCalledWith(ORIGIN, 'hi')
    expect(deps.removePending).not.toHaveBeenCalled()
  })

  it('adds the optimistic bubble in the same call the draft clears, when images are given', () => {
    const deps = drafts()

    clearDraftAtSendStartWith(deps, 'hi', ['file:///a.jpg'])

    expect(deps.clearDraftForSend).toHaveBeenCalledWith(ORIGIN, 'hi')
    expect(deps.acceptSend).toHaveBeenCalledWith(ORIGIN, 'hi', ['file:///a.jpg'])
  })

  it('retracts the bubble alongside the text when the undo runs (a definite rejection)', () => {
    const deps = drafts({ acceptSend: vi.fn(() => 'pending-7') })

    const undo = clearDraftAtSendStartWith(deps, 'hi', ['file:///a.jpg'])
    undo?.()

    expect(deps.restoreRejectedDraft).toHaveBeenCalledWith(ORIGIN, 'hi')
    expect(deps.removePending).toHaveBeenCalledWith('pending-7')
  })

  it('does not touch the pending list when acceptSend added nothing (no draft scope)', () => {
    const deps = drafts({ acceptSend: vi.fn(() => null) })

    const undo = clearDraftAtSendStartWith(deps, 'hi', ['file:///a.jpg'])
    undo?.()

    expect(deps.removePending).not.toHaveBeenCalled()
  })

  it('returns null and clears nothing when there is no draft scope to capture', () => {
    const deps = drafts({ captureSendOrigin: vi.fn(() => null) })

    const undo = clearDraftAtSendStartWith(deps, 'hi', ['file:///a.jpg'])

    expect(undo).toBeNull()
    expect(deps.clearDraftForSend).not.toHaveBeenCalled()
    expect(deps.acceptSend).not.toHaveBeenCalled()
  })
})
