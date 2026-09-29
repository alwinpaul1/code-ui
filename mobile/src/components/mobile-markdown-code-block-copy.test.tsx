import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

vi.mock('react-native', () => ({
  Linking: { openURL: () => Promise.resolve() },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('lucide-react-native', () => ({ Check: 'Check', Copy: 'Copy' }))
// The real writer runs (src/platform/clipboard.ts); only the device pasteboard
// under it is fake, so a refusal takes the path a phone's would.
const pasteboard = vi.hoisted(() => ({ written: [] as string[], accepts: true }))
vi.mock('expo-clipboard', () => ({
  setStringAsync: async (value: string) => {
    pasteboard.written.push(value)
    return pasteboard.accepts
  }
}))

import { MobileMarkdown } from './MobileMarkdown'
import { MAX_MARKDOWN_CODE_LINES } from './mobile-markdown-code-lines'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  pasteboard.written = []
  pasteboard.accepts = true
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

function render(content: string, scheme: 'light' | 'dark' = 'dark'): ReactTestRenderer {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileMarkdown content={content} />
      </ThemeProvider>
    )
  })
  return renderer!
}

function rerender(content: string, scheme: 'light' | 'dark' = 'dark'): void {
  act(() => {
    renderer!.update(
      <ThemeProvider initialPreference={scheme}>
        <MobileMarkdown content={content} />
      </ThemeProvider>
    )
  })
}

function copyButtons(tree: ReactTestRenderer): ReactTestInstance[] {
  return tree.root.findAll(
    (node) =>
      (node.type as unknown) === 'Pressable' &&
      (node.props.accessibilityLabel === 'Copy code' || node.props.accessibilityLabel === 'Copied')
  )
}

function onlyCopyButton(tree: ReactTestRenderer): ReactTestInstance {
  const buttons = copyButtons(tree)
  expect(buttons, 'one Copy button on the block').toHaveLength(1)
  return buttons[0]!
}

async function press(button: ReactTestInstance): Promise<void> {
  await act(async () => {
    await button.props.onPress()
  })
}

const textsIn = (node: ReactTestInstance): string[] =>
  node.findAllByType('Text' as never).map((text) => text.children.join(''))

function flatStyle(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(3) : [style]
  return Object.assign({}, ...list.filter((item) => item && typeof item === 'object'))
}

const fence = (info: string, lines: string[]): string => ['```' + info, ...lines, '```'].join('\n')

// 2026-09-29, from the device: "Have a copy button for code. Since I had
// this issue". A fence draws one selectable Text per line, so Android's hold
// selects inside one line and no further; a line wider than the screen
// scrolls its end out from under the handles; and past
// MAX_MARKDOWN_CODE_LINES the rest is not drawn at all. None of that can be
// selected out whole. The button copies the fence's source instead.
describe('the Copy button on a chat code block', () => {
  it('puts a multi-line block on the clipboard exactly as written, with no line numbers', async () => {
    const lines = [
      'const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0) // wider than any phone',
      '',
      '    indented\twith a tab',
      'return total'
    ]
    const tree = render(fence('', lines))
    await press(onlyCopyButton(tree))
    expect(pasteboard.written).toEqual([lines.join('\n')])
  })

  it('copies a fence with a language tag without the tag, the fence or a trailing newline', async () => {
    const tree = render(fence('python', ['def cell(em):', '    return em']))
    await press(onlyCopyButton(tree))
    expect(pasteboard.written).toEqual(['def cell(em):\n    return em'])
  })

  it('copies every line of a block too long to draw, not just the lines on screen', async () => {
    const lines = Array.from({ length: MAX_MARKDOWN_CODE_LINES + 50 }, (_, index) => `echo ${index + 1}`)
    const tree = render(fence('sh', lines))
    expect(textsIn(tree.root)).toContain('50 more lines')
    await press(onlyCopyButton(tree))
    expect(pasteboard.written).toEqual([lines.join('\n')])
  })

  it('gives each block of a message its own button, copying only that block', async () => {
    const tree = render(
      ['Install it:', '', fence('sh', ['pnpm install']), '', 'Then run:', '', fence('sh', ['pnpm test'])].join('\n')
    )
    const buttons = copyButtons(tree)
    expect(buttons).toHaveLength(2)
    await press(buttons[1]!)
    expect(pasteboard.written).toEqual(['pnpm test'])
  })

  it('copies what the block holds now while it is still streaming', async () => {
    const tree = render(['```sh', 'pnpm install'].join('\n'))
    rerender(['```sh', 'pnpm install', 'pnpm test'].join('\n'))
    await press(onlyCopyButton(tree))
    expect(pasteboard.written).toEqual(['pnpm install\npnpm test'])
  })

  // The degenerate block: nothing to copy, and a press that wrote '' would
  // empty whatever the reader had on the clipboard.
  it('has no button on an empty block, so a press can never empty the clipboard', () => {
    const tree = render(fence('sh', []))
    expect(copyButtons(tree)).toHaveLength(0)
    expect(tree.root.findAllByType('Copy' as never)).toHaveLength(0)
    expect(pasteboard.written).toEqual([])
  })

  it('says Copied with a check for 1.5 s, then goes back to Copy', async () => {
    vi.useFakeTimers()
    const tree = render(fence('sh', ['pnpm test']))
    const button = onlyCopyButton(tree)
    expect(button.props.accessibilityRole).toBe('button')
    expect(button.findAllByType('Copy' as never)).toHaveLength(1)
    await press(button)
    const copied = onlyCopyButton(tree)
    expect(copied.props.accessibilityLabel).toBe('Copied')
    expect(copied.findAllByType('Check' as never)).toHaveLength(1)
    expect(copied.findAllByType('Copy' as never)).toHaveLength(0)
    expect(textsIn(copied)).toEqual(['Copied'])
    act(() => {
      vi.advanceTimersByTime(1_499)
    })
    expect(onlyCopyButton(tree).props.accessibilityLabel).toBe('Copied')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    const back = onlyCopyButton(tree)
    expect(back.props.accessibilityLabel).toBe('Copy code')
    expect(back.findAllByType('Copy' as never)).toHaveLength(1)
    expect(back.findAllByType('Check' as never)).toHaveLength(0)
  })

  // A copy that fails without a word looks exactly like one that worked, and
  // the paste then finds whatever was there before (use-copy-to-clipboard.ts).
  it('says the copy failed, and never says Copied, when the clipboard refuses', async () => {
    pasteboard.accepts = false
    const tree = render(fence('sh', ['pnpm test']))
    await press(onlyCopyButton(tree))
    const button = onlyCopyButton(tree)
    expect(button.props.accessibilityLabel).toBe('Copy code')
    expect(button.findAllByType('Check' as never)).toHaveLength(0)
    expect(textsIn(tree.root)).toContain("Couldn't copy: the clipboard did not accept this text.")
  })

  it('leaves the list its scroll and its hold: a tap control with no long-press of its own', () => {
    const button = onlyCopyButton(render(fence('sh', ['pnpm test'])))
    expect(button.props.onLongPress).toBeUndefined()
    expect(button.props.onStartShouldSetResponderCapture).toBeUndefined()
    expect(button.props.onMoveShouldSetResponderCapture).toBeUndefined()
    expect(button.props.delayLongPress).toBeUndefined()
  })

  it('adds nothing to inline code spans', () => {
    const tree = render('Run `pnpm test` now, or `pnpm\ntest` across a line.')
    expect(copyButtons(tree)).toHaveLength(0)
    expect(tree.root.findAllByType('Copy' as never)).toHaveLength(0)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the button in the %s scheme’s colours', async (scheme, colors) => {
    const tree = render(fence('sh', ['pnpm test']), scheme)
    expect(tree.root.findByType('Copy' as never).props.color).toBe(colors.textMuted)
    await press(onlyCopyButton(tree))
    expect(tree.root.findByType('Check' as never).props.color).toBe(colors.accent)
    const label = onlyCopyButton(tree).findByType('Text' as never)
    expect(flatStyle(label.props.style)).toMatchObject({ color: colors.accentText })
  })
})
