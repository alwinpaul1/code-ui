import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const pickMobileDocuments = vi.hoisted(() => vi.fn())
vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => ({ pickImage: vi.fn() }) }))
vi.mock('./mobile-image-source-picker', () => ({ pickMobileDocuments }))

import type { RpcClient } from '../transport/rpc-client'
import { VideoFrameExtractionError } from './mobile-video-frame-extractor'
import { useMobileImageAttachment } from './use-mobile-image-attachment'

type Hook = ReturnType<typeof useMobileImageAttachment>
type Args = Parameters<typeof useMobileImageAttachment>[0]

function baseArgs(overrides: Partial<Args> & Pick<Args, 'showToast'>): Args {
  return {
    client: { sendRequest: vi.fn() } as unknown as RpcClient,
    activeHandle: 'term-1',
    canSend: true,
    connState: 'connected',
    deviceTokenRef: { current: null },
    getActiveWorktreeConnectionId: async () => null,
    onSuccess: vi.fn(),
    onError: vi.fn(),
    ...overrides
  }
}

// 2026-09-27 review: the classic terminal-attach screen (no chip strip, no
// progress, no cancel) used to extract an over-cap video's frames anyway and
// then type a note with no path for them — the agent had nothing to read.
// This screen now opts out of extraction entirely and keeps today's outright
// refusal for that one case.
describe('useMobileImageAttachment — attachDocument and a video', () => {
  let renderer: ReactTestRenderer | null = null
  let hook: Hook | null = null

  function Harness({ args }: { args: Args }): null {
    hook = useMobileImageAttachment(args)
    return null
  }
  function mount(args: Args): void {
    act(() => {
      renderer = create(createElement(Harness, { args }))
    })
  }

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
    pickMobileDocuments.mockReset()
  })

  it('picks documents with "refuse", opting the video-frames path out entirely', async () => {
    pickMobileDocuments.mockImplementation(async function* () {})
    mount(baseArgs({ showToast: vi.fn() }))

    await act(async () => {
      await hook!.attachDocument()
    })

    expect(pickMobileDocuments).toHaveBeenCalledExactlyOnceWith(undefined, undefined, 'refuse')
  })

  it('names the reason, not a bare "Attach failed", if a VideoFrameExtractionError is ever reached here', async () => {
    // Defensive: this screen's own wiring never extracts (see above), but
    // `run()`'s error handling still maps this error type correctly, in case
    // some other path ever reaches it.
    // oxlint-disable-next-line require-yield -- fails before any document is ever yielded.
    pickMobileDocuments.mockImplementation(async function* () {
      throw new VideoFrameExtractionError('Timed out waiting for the video to load')
    })
    const showToast = vi.fn()
    mount(baseArgs({ showToast }))

    await act(async () => {
      await hook!.attachDocument()
    })

    expect(showToast).toHaveBeenCalledExactlyOnceWith(
      'File too large to attach (18 MB max) — the video took too long to load',
      1500
    )
  })
})
