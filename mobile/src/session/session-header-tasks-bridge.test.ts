import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBridgeBackgroundTasksToHeader, useHeaderBackgroundTasks } from './session-header-tasks-bridge'

// The header menu's Background tasks entry (parity gap G35) opens the sheet the chat's tasks
// provider owns, in a different subtree. The bridge carries the running count up and the open
// request down, and forgets both when the chat unmounts, so the header never offers a sheet that is
// not there.

let renderers: ReactTestRenderer[] = []
afterEach(() => {
  act(() => renderers.forEach((renderer) => renderer.unmount()))
  renderers = []
})

function Provider(props: { count: number; open: () => void }): null {
  useBridgeBackgroundTasksToHeader(props.count, props.open)
  return null
}

function readHeader() {
  const seen: ReturnType<typeof useHeaderBackgroundTasks>[] = []
  function Header(): null {
    seen.push(useHeaderBackgroundTasks())
    return null
  }
  act(() => {
    renderers.push(create(createElement(Header)))
  })
  return seen
}

describe('the header reads the chat’s background tasks through the bridge', () => {
  it('has nothing to offer while no chat is mounted', () => {
    const seen = readHeader()
    expect(seen.at(-1)).toEqual({ runningCount: 0, open: null })
  })

  it('carries the running count and opens the sheet the chat owns', () => {
    const seen = readHeader()
    const open = vi.fn()
    let provider: ReactTestRenderer | null = null
    act(() => {
      provider = create(createElement(Provider, { count: 2, open }))
    })
    renderers.push(provider!)
    expect(seen.at(-1)?.runningCount).toBe(2)
    seen.at(-1)?.open?.()
    expect(open).toHaveBeenCalledTimes(1)
    act(() => provider!.update(createElement(Provider, { count: 1, open })))
    expect(seen.at(-1)?.runningCount).toBe(1)
  })

  it('forgets the chat when it unmounts', () => {
    const seen = readHeader()
    let provider: ReactTestRenderer | null = null
    act(() => {
      provider = create(createElement(Provider, { count: 3, open: () => {} }))
    })
    act(() => provider!.unmount())
    expect(seen.at(-1)).toEqual({ runningCount: 0, open: null })
  })

  it('keeps the newer chat when an older one unmounts after it mounted', () => {
    const seen = readHeader()
    const older = vi.fn()
    const newer = vi.fn()
    let first: ReactTestRenderer | null = null
    let second: ReactTestRenderer | null = null
    act(() => {
      first = create(createElement(Provider, { count: 1, open: older }))
    })
    act(() => {
      second = create(createElement(Provider, { count: 4, open: newer }))
    })
    renderers.push(second!)
    act(() => first!.unmount())
    expect(seen.at(-1)?.runningCount).toBe(4)
    seen.at(-1)?.open?.()
    expect(newer).toHaveBeenCalledTimes(1)
    expect(older).not.toHaveBeenCalled()
  })
})
