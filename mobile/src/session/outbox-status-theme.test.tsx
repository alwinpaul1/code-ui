// The line under a message the outbox is still seeing through: nothing at all while it is on its
// way (2026-10-10, the user on 0.9.127: "why showing sending, that's not good, send it as fast as
// possible"; the bubble alone says it was sent, as a normal sent message does), and "Not sent" with
// Retry and Edit only for a real failure, drawn through the real Txt under both themes. A literal
// colour would pass every other test and still ship one theme's ink on the other's canvas.

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio } from '../test/contrast'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))

import { MobileNativeChatOutboxStatus, OUTBOX_STATUS_COPY } from './MobileNativeChatOutboxStatus'

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map(flat))
  }
  return (style ?? {}) as Record<string, unknown>
}

function textNode(content: string): ReactTestInstance {
  const node = renderer!.root.findAll(
    (candidate) => (candidate.type as unknown) === 'Text' && [candidate.props.children].flat().join('') === content
  )[0]
  expect(node, `no "${content}" under the bubble`).toBeDefined()
  return node!
}

describe('the outbox line under a message, in light and dark', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws no "Sending…" under a message on its way, and Not sent · Retry · Edit in %s ink', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatOutboxStatus delivery="sending" />
        </ThemeProvider>
      )
    })
    // No label, no spinner: the line is not drawn at all.
    expect(renderer!.toJSON()).toBeNull()
    expect(
      renderer!.root.findAll((node) => (node.type as unknown) === 'Text' && /sending/i.test([node.props.children].flat().join('')))
    ).toEqual([])

    const onRetry = vi.fn()
    const onEdit = vi.fn()
    act(() => {
      renderer!.update(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatOutboxStatus delivery="failed" onRetry={onRetry} onEdit={onEdit} />
        </ThemeProvider>
      )
    })
    const failed = flat(textNode(OUTBOX_STATUS_COPY.failed).props.style).color as string
    expect(failed).toBe(palette.danger)
    expect(contrastRatio(failed, palette.bg)).toBeGreaterThanOrEqual(3)
    const retry = flat(textNode(OUTBOX_STATUS_COPY.retry).props.style).color as string
    expect(retry).toBe(palette.accentText)
    expect(contrastRatio(retry, palette.bg)).toBeGreaterThanOrEqual(3)
    expect(flat(textNode(OUTBOX_STATUS_COPY.edit).props.style).color).toBe(palette.textSecondary)

    const [retryButton, editButton] = renderer!.root.findAll(
      (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'button'
    )
    act(() => retryButton!.props.onPress())
    act(() => editButton!.props.onPress())
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
