import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

// The system font size (Settings > Display > Font size), on the Android 14
// curve the user's S23 draws with.
const device = vi.hoisted(() => ({ fontScale: 1 }))
vi.mock('react-native', () => ({
  Linking: { openURL: () => Promise.resolve() },
  PixelRatio: { get: () => 3, getFontScale: () => device.fontScale },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  Platform: { OS: 'android', Version: 34, select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('lucide-react-native', () => ({ Check: 'Check', Copy: 'Copy' }))
// The real writer runs (src/platform/clipboard.ts); only the device pasteboard
// under it is fake, so a refusal takes the path a phone's would.
// `held` keeps a write pending until the test lets it land.
const pasteboard = vi.hoisted(() => ({
  written: [] as string[],
  accepts: true,
  held: false,
  land: null as ((accepted: boolean) => void) | null
}))
vi.mock('expo-clipboard', () => ({
  setStringAsync: async (value: string) => {
    pasteboard.written.push(value)
    if (pasteboard.held) {
      return await new Promise<boolean>((resolve) => {
        pasteboard.land = resolve
      })
    }
    return pasteboard.accepts
  }
}))

import { MobileMarkdown } from './MobileMarkdown'
import { MAX_MARKDOWN_CODE_LINES } from './mobile-markdown-code-lines'
import { makeMarkdownStyles } from './mobile-markdown-styles'
import { systemSpScale } from './system-font-scale'
import { ThemeProvider, type Theme } from '../theme/theme-context'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import { contrastRatio } from '../test/contrast'

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  pasteboard.written = []
  pasteboard.accepts = true
  pasteboard.held = false
  pasteboard.land = null
  device.fontScale = 1
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

const headers = (tree: ReactTestRenderer): ReactTestInstance[] =>
  tree.root.findAll((node) => (node.type as unknown) === 'View' && node.props.testID === 'markdown-code-header')

function themeFor(scheme: 'light' | 'dark'): Theme {
  return {
    scheme,
    preference: scheme,
    setPreference: () => undefined,
    colors: scheme === 'dark' ? darkColors : lightColors,
    syntax: syntaxPaletteForScheme(scheme),
    space,
    radius,
    type,
    fonts: fontFamily,
    isDark: scheme === 'dark'
  }
}

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

  // Review of this button (2026-09-29): a fence under a list item went
  // through the HTML pass, so it drew and copied `return\n  {label}\n`.
  it('copies a fence under a list item exactly, its tags, entities and blank lines included', async () => {
    const tree = render(
      [
        '1. Render the row:',
        '',
        '   ```tsx',
        '   return <View style={s.row}>',
        '     <Text>{label}</Text>',
        '',
        '',
        '',
        '     {a &amp;&amp; b}',
        '   </View>',
        '   ```'
      ].join('\n')
    )
    await press(onlyCopyButton(tree))
    expect(pasteboard.written).toEqual([
      ['return <View style={s.row}>', '  <Text>{label}</Text>', '', '', '', '  {a &amp;&amp; b}', '</View>'].join('\n')
    ])
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

  // A closed empty fence with no language had nothing to put in its header
  // and drew an empty strip above its one blank line.
  it('draws no header on a finished empty fence with no language', () => {
    expect(headers(render(fence('', [])))).toHaveLength(0)
    expect(headers(render(fence('sh', [])))).toHaveLength(1)
  })

  // While a fence streams, its row is already there, so the first character
  // bringing the button in does not push the code down.
  it('keeps the header row on a fence that is still opening', () => {
    expect(headers(render('```'))).toHaveLength(1)
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

  // The chat list unmounts a message once it scrolls out of the draw window;
  // a copy still in flight must not arm the 1.5 s timer after it is gone.
  it('leaves no timer behind when the block goes away before the copy lands', async () => {
    vi.useFakeTimers()
    pasteboard.held = true
    const tree = render(fence('sh', ['pnpm test']))
    const pending = onlyCopyButton(tree).props.onPress() as Promise<boolean>
    await act(async () => {
      await Promise.resolve()
    })
    expect(pasteboard.land).not.toBeNull()
    act(() => tree.unmount())
    renderer = null
    await act(async () => {
      pasteboard.land!(true)
      await pending
    })
    expect(vi.getTimerCount()).toBe(0)
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

  // Review (2026-09-29): the refusal was drawn in `danger`, 4.48:1 on the
  // light code fill, under AA for 11 px text.
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('reads on the code fill in the %s scheme, refusal included', async (scheme, colors) => {
    pasteboard.accepts = false
    const tree = render(fence('sh', ['pnpm test']), scheme)
    expect(contrastRatio(tree.root.findByType('Copy' as never).props.color, colors.codeBg)).toBeGreaterThanOrEqual(3)
    await press(onlyCopyButton(tree))
    const notice = tree.root
      .findAllByType('Text' as never)
      .find((text) => text.children.join('').startsWith("Couldn't copy"))!
    expect(contrastRatio(String(flatStyle(notice.props.style).color), colors.codeBg)).toBeGreaterThanOrEqual(4.5)
    pasteboard.accepts = true
    await press(onlyCopyButton(tree))
    expect(contrastRatio(tree.root.findByType('Check' as never).props.color, colors.codeBg)).toBeGreaterThanOrEqual(3)
    const label = onlyCopyButton(tree).findByType('Text' as never)
    expect(contrastRatio(String(flatStyle(label.props.style).color), colors.codeBg)).toBeGreaterThanOrEqual(4.5)
  })
})

// Review (2026-09-29): the row was a fixed 18 dp, but "Copied" is text and
// grows with the system font size, so at 130% the block grew for 1.5 s and
// shrank back under the reader.
describe('the code block header at the system font size', () => {
  it.each([1, 1.3, 1.5, 2])('is already as tall as the Copied label at %sx', (fontScale) => {
    device.fontScale = fontScale
    const styles = makeMarkdownStyles(themeFor('light'))
    const label = Number(styles.codeCopied.lineHeight)
    const padding = 2 * Number(styles.codeCopy.paddingVertical)
    expect(Number(styles.codeHeader.minHeight)).toBeGreaterThanOrEqual(systemSpScale().toDp(label) + padding)
  })
})
