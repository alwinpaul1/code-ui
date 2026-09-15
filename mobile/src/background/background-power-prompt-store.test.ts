import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeBackgroundPowerPrompt,
  openBackgroundPowerPrompt,
  resetBackgroundPowerPromptForTests,
  useBackgroundPowerPromptOpen
} from './background-power-prompt-store'

let latest = false
function Probe(): null {
  latest = useBackgroundPowerPromptOpen()
  return null
}

/**
 * The battery prompt is raised from a launch effect, outside the React tree, so
 * it travels as a flag one mounted component watches.
 *
 * `Alert.alert` was the first shape and was wrong: the native dialog takes
 * Android's colours rather than the reader's chosen theme, and this app has to
 * work in light and dark (2026-09-15).
 */
describe('raising the battery prompt from outside the React tree', () => {
  let renderer: ReactTestRenderer | null = null
  beforeEach(() => {
    resetBackgroundPowerPromptForTests()
    latest = false
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function mount(): void {
    act(() => {
      renderer = create(createElement(Probe))
    })
  }

  it('starts closed', () => {
    mount()
    expect(latest).toBe(false)
  })

  it('opens the mounted sheet when the launch effect asks', () => {
    mount()
    act(() => openBackgroundPowerPrompt())
    expect(latest).toBe(true)
  })

  it('closes again when the reader answers', () => {
    mount()
    act(() => openBackgroundPowerPrompt())
    act(() => closeBackgroundPowerPrompt())
    expect(latest).toBe(false)
  })

  it('stays open rather than reopening when asked twice', () => {
    mount()
    act(() => openBackgroundPowerPrompt())
    act(() => openBackgroundPowerPrompt())
    expect(latest).toBe(true)
  })
})
