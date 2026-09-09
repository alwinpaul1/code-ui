import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default }
}))

import { Button } from './Button'

function render(props: Parameters<typeof Button>[0]): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(Button, props))
  })
  return renderer!
}

function alignSelfOf(element: ReactTestRenderer): string | undefined {
  const node = element.root.findAll((n) => Array.isArray(n.props.style) || typeof n.props.style === 'object')[0]
  const styles = ([] as unknown[]).concat(node?.props.style ?? [])
  const merged = Object.assign({}, ...styles.filter(Boolean).map((s) => (Array.isArray(s) ? Object.assign({}, ...s) : s)))
  return merged.alignSelf
}

// Seen on the Galaxy S23 (2026-09-09): the empty workspace's "New tab" button
// sat at the left edge under centred text, because the button pinned itself to
// flex-start whatever its parent asked. The fix is a prop, so nothing else moves.
describe('Button alignment', () => {
  it('hugs the start by default so existing compact buttons stay put', () => {
    expect(alignSelfOf(render({ label: 'Retry' }))).toBe('flex-start')
  })

  it('follows a centred parent when asked, on any screen width', () => {
    expect(alignSelfOf(render({ label: 'New tab', align: 'center' }))).toBe('center')
  })

  it('still stretches when block, whatever align says', () => {
    expect(alignSelfOf(render({ label: 'Pair', block: true, align: 'center' }))).toBe('stretch')
  })
})
