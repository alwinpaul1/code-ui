import { createElement, useRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  listeners: new Set<(image: { viewTag: number; uri: string; mimeType: string }) => void>(),
  attach: vi.fn((tag: number) => tag > 0),
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

function emit(viewTag: number, uri: string) {
  for (const listener of native.listeners) {
    listener({ viewTag, uri, mimeType: 'image/png' })
  }
}

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  vi.useFakeTimers()
  native.attach.mockClear()
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
  it('hands the composer the image the keyboard put into ITS input, not another', () => {
    const onImageFile = vi.fn()
    act(() => {
      renderer = create(createElement(Host, { onImageFile }))
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

  it('lets go of the input when the composer unmounts', () => {
    act(() => {
      renderer = create(createElement(Host, { onImageFile: vi.fn() }))
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
