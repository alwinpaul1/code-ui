// PickerModal's optional notices (loading, failed, empty) and the 26 callers that set none of them.
//
// The picker is shared, so the notices are opt-in: a caller that passes none must draw exactly
// the sheet it drew before, an empty options list included (an empty sheet, no invented copy).

import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { PickerModal } from './PickerModal'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ Check: 'Check' }))
vi.mock('./BottomDrawer', async () => {
  const { createElement: h } = await import('react')
  return {
    BottomDrawer: ({ children }: { children?: ReactNode }) => h('BottomDrawer', null, children)
  }
})

type Notices = Pick<
  Parameters<typeof PickerModal>[0],
  'loadingLabel' | 'failure' | 'emptyLabel' | 'options'
>

function flatStyle(style: unknown): Record<string, unknown> {
  const list = (Array.isArray(style) ? style.flat(3) : [style]).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
  )
  return Object.assign({}, ...list)
}

describe('PickerModal notices', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(props: Notices, scheme: 'light' | 'dark' = 'light') {
    act(() => {
      renderer = create(
        createElement(
          ThemeProvider,
          { initialPreference: scheme },
          createElement(PickerModal, {
            visible: true,
            title: 'Pick',
            selected: 'a',
            onSelect: () => undefined,
            onClose: () => undefined,
            ...props
          })
        )
      )
    })
  }

  function texts(): string[] {
    return renderer!.root
      .findAllByType('Text' as never)
      .map((node) => [node.props.children].flat().join(''))
  }

  it('draws an empty sheet, with no copy of its own, for a caller that sets no notice', () => {
    render({ options: [] })
    expect(texts()).toEqual(['Pick'])
    expect(renderer!.root.findAllByType('Pressable' as never)).toHaveLength(0)
    expect(renderer!.root.findAllByType('ActivityIndicator' as never)).toHaveLength(0)
  })

  it('draws one row for one option, and the rows for several, when no notice is set', () => {
    render({ options: [{ value: 'a', label: 'Alpha' }] })
    expect(texts()).toEqual(['Pick', 'Alpha'])
    render({ options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta', subtitle: 'two' }] })
    expect(texts()).toEqual(['Pick', 'Alpha', 'Beta', 'two'])
  })

  it('keeps the rows, not the empty notice, when there are options', () => {
    render({ options: [{ value: 'a', label: 'Alpha' }], emptyLabel: 'Nothing here' })
    expect(texts()).toEqual(['Pick', 'Alpha'])
  })

  it('shows the empty notice only when there are no options', () => {
    render({ options: [], emptyLabel: 'Nothing here' })
    expect(texts()).toEqual(['Pick', 'Nothing here'])
  })

  it('shows the loading notice with a spinner in place of the rows', () => {
    render({ options: [], loadingLabel: 'Loading…', emptyLabel: 'Nothing here' })
    expect(texts()).toEqual(['Pick', 'Loading…'])
    expect(renderer!.root.findAllByType('ActivityIndicator' as never)).toHaveLength(1)
  })

  it('puts a failure ahead of loading and offers Retry', () => {
    const onRetry = vi.fn()
    render({
      options: [],
      loadingLabel: 'Loading…',
      failure: { message: 'It failed', onRetry, retryLabel: 'Retry the read' }
    })
    expect(texts()).toEqual(['Pick', 'It failed', 'Retry'])
    const retry = renderer!.root.findByType('Pressable' as never)
    expect(retry.props.accessibilityLabel).toBe('Retry the read')
    act(() => retry.props.onPress())
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('paints the notices from the %s theme', (scheme, palette) => {
    render({ options: [], loadingLabel: 'Loading…' }, scheme)
    expect(renderer!.root.findByType('ActivityIndicator' as never).props.color).toBe(
      palette.textSecondary
    )
    const loading = renderer!.root
      .findAllByType('Text' as never)
      .find((node) => node.props.children === 'Loading…')
    expect(flatStyle(loading!.props.style).color).toBe(palette.textMuted)

    render({ options: [], failure: { message: 'It failed', onRetry: () => undefined } }, scheme)
    const retry = renderer!.root.findByType('Pressable' as never)
    expect(flatStyle(retry.props.style).backgroundColor).toBe(palette.bgRaised)
    const retryText = retry.findByType('Text' as never)
    expect(flatStyle(retryText.props.style).color).toBe(palette.text)
  })
})
