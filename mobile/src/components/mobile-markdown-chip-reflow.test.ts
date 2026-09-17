import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'

vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

/**
 * An inline-code chip is a real View inside the paragraph's Text — the only
 * way Android rounds it. Android positions such a View from the paragraph's
 * layout, and it does NOT move the View when the paragraph re-wraps unless the
 * View itself changes. A chip near a line break was therefore drawn where it
 * had been BEFORE the text ahead of it moved down a line, on top of the words
 * that now occupy that spot: "commits on `main`" rendered with the `main` pill
 * across "commits" (reported from the phone 2026-09-18, on a message that had
 * streamed in and re-wrapped as it grew).
 *
 * React reconciles the chip by key. A key that is stable across a re-wrap keeps
 * the stale View; a key that includes the paragraph's text makes a re-wrap a
 * remount, and a remounted View is positioned from the current layout.
 *
 * Asserted on the key rather than on a position, because there is no layout
 * engine here to produce one. The key is the mechanism.
 */
describe('an inline code chip follows the paragraph it sits in', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function chipKeys(content: string): string[] {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content }))
    })
    // A test instance does not expose its key; the fiber underneath does.
    // Chips are told from other Views by the rounding only they carry.
    return renderer!.root
      .findAll(
        (node: ReactTestInstance) => node.type === 'View' && node.props.style?.borderRadius === 7
      )
      .map((node) => String((node as unknown as { _fiber: { key: string | null } })._fiber.key))
  }

  it('remounts the chip when the text around it grows', () => {
    const before = chipKeys('commits on `main`, unpushed')
    act(() => renderer?.unmount())
    renderer = null
    const after = chipKeys('commits on `main`, unpushed. Once you have confirmed the reboot test')
    expect(before).toHaveLength(1)
    expect(after).toHaveLength(1)
    expect(after[0]).not.toBe(before[0])
  })

  it('keeps the chip mounted when nothing around it changes', () => {
    const first = chipKeys('commits on `main`, unpushed')
    act(() => renderer?.unmount())
    renderer = null
    const again = chipKeys('commits on `main`, unpushed')
    expect(again).toEqual(first)
  })

  // Two chips in one paragraph must still be told apart.
  it('gives sibling chips distinct keys', () => {
    const keys = chipKeys('run `pnpm install` then `pnpm test`')
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
  })
})
