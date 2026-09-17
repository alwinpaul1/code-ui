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
    expect(latest).toBeNull()
  })

  /**
   * Two kinds, because "we are asking" and "that did not work" are different
   * things to say. Reopening the original ask after a grant silently failed is
   * what made people report it "appeared for people who allowed too" — the app
   * looked like it had not noticed.
   */
  it('opens the follow-up as its own kind', () => {
    mount()
    act(() => openBackgroundPowerPrompt('not-taken'))
    expect(latest).toBe('not-taken')
  })

  it('replaces the ask with the follow-up rather than ignoring it', () => {
    mount()
    act(() => openBackgroundPowerPrompt('ask'))
    act(() => openBackgroundPowerPrompt('not-taken'))
    expect(latest).toBe('not-taken')
  })

  it('opens the mounted sheet when the launch effect asks', () => {
    mount()
    act(() => openBackgroundPowerPrompt())
    expect(latest).toBe('ask')
  })

  it('closes again when the reader answers', () => {
    mount()
    act(() => openBackgroundPowerPrompt())
    act(() => closeBackgroundPowerPrompt())
    expect(latest).toBeNull()
  })

  it('stays open rather than reopening when asked twice', () => {
    mount()
    act(() => openBackgroundPowerPrompt())
    act(() => openBackgroundPowerPrompt())
    expect(latest).toBe('ask')
  })
})
