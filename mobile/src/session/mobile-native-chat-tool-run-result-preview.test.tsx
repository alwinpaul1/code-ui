import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'

// The same host stand-ins as MobileNativeChatToolRun.test.tsx.
vi.mock('react-native', () => ({
  Animated: {
    View: 'View',
    Text: 'Text',
    Value: class {
      constructor(private value: number) {}
      setValue(next: number): void {
        this.value = next
      }
    },
    loop: (animation: unknown) => animation,
    sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
    timing: () => ({ start: vi.fn(), stop: vi.fn() })
  },
  Platform: { OS: 'android', Version: 34 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  Circle: 'Circle',
  CircleCheck: 'CircleCheck',
  CircleDot: 'CircleDot',
  ListChecks: 'ListChecks',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({
  MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet'
}))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => false }))

const LONE_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const ROCKET = '🚀'

function Harness({ blocks }: { blocks: NativeChatBlock[] }): React.JSX.Element {
  const styles = useChatMessageStyles()
  return createElement(ToolRun, { blocks, defaultExpanded: true, activeCall: null, styles })
}

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

/** The row preview drawn for a result whose call the loaded window does not
 *  hold (it paginated out above), in the given theme; null when none is drawn. */
function previewOfOrphanResult(output: string, scheme: 'light' | 'dark' = 'light'): string | null {
  act(() => renderer?.unmount())
  act(() => {
    renderer = create(
      createElement(
        ThemeProvider,
        { initialPreference: scheme },
        createElement(Harness, { blocks: [{ type: 'tool-result', output }] })
      )
    )
  })
  const nodes = renderer!.root.findAll((node) => node.props?.testID === 'tool-line-preview' && node.type === 'Text')
  return nodes.length === 0 ? null : [nodes[0]!.props.children].flat().join('')
}

// A result row with no call previews the first line of its output, cut at 80
// UTF-16 code units. An emoji is two, and a cut between them drew half of it,
// a broken glyph, at the end of the row.
describe('a result row previewing output with an emoji at the 80-character cap', () => {
  it('keeps a rocket emoji whole when it straddles the cut, in light and dark', () => {
    // "✓ deployed " is 11 code units, so the filler puts the rocket on 79 and 80.
    const output = `✓ deployed ${'x'.repeat(68)}${ROCKET} to staging\nsecond line`
    for (const scheme of ['light', 'dark'] as const) {
      const preview = previewOfOrphanResult(output, scheme)
      expect(preview).not.toMatch(LONE_HALF)
      expect(preview).toBe(`✓ deployed ${'x'.repeat(68)}`)
    }
  })

  it('keeps an emoji that ends just before the cut', () => {
    expect(previewOfOrphanResult(`${'x'.repeat(78)}${ROCKET} to staging`)).toBe(`${'x'.repeat(78)}${ROCKET}`)
  })

  it('shows a first line of exactly 80 code units whole, and cuts one a unit over', () => {
    const exact = `${'x'.repeat(78)}${ROCKET}`
    expect(previewOfOrphanResult(`${exact}\nmore`)).toBe(exact)
    const over = previewOfOrphanResult(`${'x'.repeat(79)}${ROCKET}`)
    expect(over).not.toMatch(LONE_HALF)
    expect(over).toBe('x'.repeat(79))
  })

  it('draws no preview for an empty result', () => {
    expect(previewOfOrphanResult('')).toBeNull()
  })

  it('cuts a first line made only of emoji between two of them', () => {
    const preview = previewOfOrphanResult(`✅${ROCKET.repeat(50)}`)
    expect(preview).not.toMatch(LONE_HALF)
    expect(preview).toBe(`✅${ROCKET.repeat(39)}`)
  })
})
