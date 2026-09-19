import { createElement, useRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  listeners: new Set<(image: { viewTag: number; uri: string; mimeType: string }) => void>(),
  attach: vi.fn(async (tag: number) => tag > 0),
  detach: vi.fn(),
  supported: true
}))

vi.mock('@codeui/expo-rich-paste', () => ({
  get isRichPasteSupported() {
    return native.supported
  },
  attachRichPaste: native.attach,
  detachRichPaste: native.detach,
  addRichPasteImageListener: (listener: (image: { viewTag: number; uri: string; mimeType: string }) => void) => {
    native.listeners.add(listener)
    return { remove: () => native.listeners.delete(listener) }
  }
}))

const handles = vi.hoisted(() => ({ tag: 41 as number | null }))
vi.mock('react-native', () => ({
  findNodeHandle: () => handles.tag
}))

import { useRichPasteInput } from './use-rich-paste-input'

function Host({ onImageFile }: { onImageFile?: (uri: string) => void }) {
  const ref = useRef<object>({ mounted: true })
  useRichPasteInput(ref as never, onImageFile)
  return null
}

/** The attach settles over two microtasks (the async mock, then `.then`). */
async function flushMicrotasks() {
  for (let i = 0; i < 4; i += 1) {
    await Promise.resolve()
  }
}

function emit(viewTag: number, uri: string) {
  for (const listener of native.listeners) {
    listener({ viewTag, uri, mimeType: 'image/png' })
  }
}

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  vi.useFakeTimers()
  // Reset, not clear: some cases install their own attach implementation.
  native.attach.mockReset()
  native.attach.mockImplementation(async (tag: number) => tag > 0)
  native.detach.mockClear()
  native.listeners.clear()
  native.supported = true
  handles.tag = 41
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

describe('pasting an image into the composer', () => {
  it('hands the composer the image the keyboard put into ITS input, not another', async () => {
    const onImageFile = vi.fn()
    act(() => {
      renderer = create(createElement(Host, { onImageFile }))
    })
    await act(async () => {
      await flushMicrotasks()
    })
    expect(native.attach).toHaveBeenCalledWith(41)
    act(() => emit(41, 'file:///cache/rich-paste/a.png'))
    act(() => emit(7, 'file:///cache/rich-paste/other.png'))
    expect(onImageFile).toHaveBeenCalledTimes(1)
    expect(onImageFile).toHaveBeenCalledWith('file:///cache/rich-paste/a.png')
  })

  it('retries the attach once the input has a native view', () => {
    handles.tag = null
    act(() => {
      renderer = create(createElement(Host, { onImageFile: vi.fn() }))
    })
    expect(native.attach).not.toHaveBeenCalled()
    handles.tag = 41
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(native.attach).toHaveBeenCalledWith(41)
  })

  it('survives a native view the mount has not produced yet, and attaches when it has', async () => {
    // Device 2026-09-19: "Call to function 'RichPaste.attach' has been
    // rejected. Caused by: IllegalViewOperationException: Unable to find view
    // for tag 7800" — Fabric mounts on the UI thread after the JS commit, so
    // the tag the effect read named a view that did not exist yet. The native
    // call threw, the effect threw, and the error boundary replaced the whole
    // screen with "Something went wrong". A missed attach must cost the paste,
    // never the screen.
    let calls = 0
    native.attach.mockImplementation(async () => {
      calls += 1
      if (calls === 1) {
        throw new Error("Call to function 'RichPaste.attach' has been rejected.")
      }
      return true
    })
    const onImageFile = vi.fn()
    act(() => {
      renderer = create(createElement(Host, { onImageFile }))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(native.attach).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(300)
      await flushMicrotasks()
    })
    expect(native.attach).toHaveBeenCalledTimes(2)
    act(() => emit(41, 'file:///cache/rich-paste/a.png'))
    expect(onImageFile).toHaveBeenCalledWith('file:///cache/rich-paste/a.png')
  })

  it('keeps trying, then gives up quietly, on an input whose view never appears', async () => {
    native.attach.mockImplementation(async () => false)
    act(() => {
      renderer = create(createElement(Host, { onImageFile: vi.fn() }))
    })
    await act(async () => {
      vi.advanceTimersByTime(5000)
      await Promise.resolve()
    })
    // Bounded: a handful of attempts, not a timer for the life of the screen.
    expect(native.attach.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(native.attach.mock.calls.length).toBeLessThanOrEqual(6)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('lets go of the input when the composer unmounts', async () => {
    act(() => {
      renderer = create(createElement(Host, { onImageFile: vi.fn() }))
    })
    await act(async () => {
      await flushMicrotasks()
    })
    act(() => renderer!.unmount())
    renderer = null
    expect(native.detach).toHaveBeenCalledWith(41)
    expect(native.listeners.size).toBe(0)
  })

  it('does nothing where images cannot be attached, or the module is absent', () => {
    act(() => {
      renderer = create(createElement(Host, {}))
    })
    expect(native.attach).not.toHaveBeenCalled()
    act(() => renderer!.unmount())
    renderer = null
    native.supported = false
    act(() => {
      renderer = create(createElement(Host, { onImageFile: vi.fn() }))
    })
    expect(native.attach).not.toHaveBeenCalled()
  })
})
