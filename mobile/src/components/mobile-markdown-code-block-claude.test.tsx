import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

// The fenced code block, after the Claude Android app 1.261009.20 (decompiled
// 2026-10-14; the numbers and where each was read are in code-block-spec.ts):
// a rounded card with a header row (the language, or "Code", then Copy and
// Expand) over the code on one line per source line, scrolling sideways.
// Expand opens a sheet: a close cross, the title, Copy, and the code full width.

const mocks = vi.hoisted(() => ({
  reduced: false,
  /** Every withTiming the card or sheet asked for, in order. */
  timings: [] as { to: number; duration: number | undefined }[],
  sheets: [] as Record<string, unknown>[]
}))

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(mocks.reduced)
  },
  Linking: { openURL: () => Promise.resolve() },
  PixelRatio: { get: () => 3, getFontScale: () => 1 },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'dark',
  Platform: { OS: 'android', Version: 34, select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 }
}))
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  return {
    default: {
      View: 'AnimatedView',
      createAnimatedComponent: (component: unknown) => component
    },
    Easing: { out: (fn: unknown) => fn, quad: (t: number) => t },
    // One object for the component's life, as the real hook gives, so a write
    // in an effect is what the next read of the style sees.
    useSharedValue: (initial: number) => React.useRef({ value: initial }).current,
    // The style reads the shared value when it is READ, not when the component
    // rendered: the worklet runs on every frame, and an effect's write has no
    // render of its own to show up in.
    useAnimatedStyle: <T extends object>(factory: () => T) =>
      new Proxy({} as T, {
        ownKeys: () => Reflect.ownKeys(factory()),
        getOwnPropertyDescriptor: (_target, key) => ({
          enumerable: true,
          configurable: true,
          value: (factory() as Record<PropertyKey, unknown>)[key]
        }),
        get: (_target, key) => (factory() as Record<PropertyKey, unknown>)[key]
      }),
    cancelAnimation: () => {},
    withTiming: (to: number, config?: { duration?: number }) => {
      mocks.timings.push({ to, duration: config?.duration })
      return to
    }
  }
})
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('lucide-react-native', () => ({ Check: 'Check', Copy: 'Copy', Maximize2: 'Maximize2', X: 'X' }))
// The sheet's own motion and gestures are the drawer's, pinned by its tests.
// The stub draws what the sheet hands it, so these tests read the sheet's
// header, body and the props it asked the drawer for.
vi.mock('./BottomDrawer', () => ({
  BottomDrawer: (props: { visible: boolean; header?: unknown; children?: unknown }) => {
    const { header, children, ...rest } = props
    mocks.sheets.push(rest)
    return props.visible ? createElement('BottomDrawer', rest, header as never, children as never) : null
  }
}))
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
import { contrastRatio } from '../test/contrast'
import { resetReducedMotionForTests } from '../ui/use-reduced-motion'

// What the Claude app draws, as the decompile gives it (pl7.s, pl7.r, pl7.P and
// the colour the Copy glyph goes to once copied, ad5.K), per scheme.
const SPEC = {
  light: { header: '#F0EFEC', body: '#F3F3F0', label: '#383835', copied: '#006300' },
  dark: { header: '#0D0D0D', body: '#111111', label: '#C3C2B7', copied: '#0CA30C' }
} as const

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  pasteboard.written = []
  pasteboard.accepts = true
  mocks.reduced = false
  mocks.timings.length = 0
  mocks.sheets.length = 0
  resetReducedMotionForTests()
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

async function render(content: string, scheme: 'light' | 'dark' = 'dark'): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileMarkdown content={content} />
      </ThemeProvider>
    )
  })
  return renderer!
}

const fence = (info: string, lines: string[]): string => ['```' + info, ...lines, '```'].join('\n')

function flatStyle(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(3) : [style]
  return Object.assign({}, ...list.filter((item) => item && typeof item === 'object'))
}

const byType = (tree: ReactTestRenderer | ReactTestInstance, type: string): ReactTestInstance[] =>
  ('root' in tree ? tree.root : tree).findAll((node) => (node.type as unknown) === type)
const byId = (tree: ReactTestRenderer | ReactTestInstance, testID: string): ReactTestInstance[] =>
  ('root' in tree ? tree.root : tree).findAll((node) => typeof node.type === 'string' && node.props.testID === testID)
/** The words each Text holds itself; a run's coloured spans are Texts of their own. */
const textsIn = (node: ReactTestInstance): string[] =>
  node
    .findAllByType('Text' as never)
    .map((text) => text.children.filter((child) => typeof child === 'string').join(''))
const buttonLabelled = (tree: ReactTestRenderer | ReactTestInstance, ...labels: string[]): ReactTestInstance[] =>
  byType(tree, 'Pressable').filter((node) => labels.includes(String(node.props.accessibilityLabel)))

const header = (tree: ReactTestRenderer): ReactTestInstance => {
  const found = byId(tree, 'markdown-code-header')
  expect(found, 'one header on the block').toHaveLength(1)
  return found[0]!
}
const label = (tree: ReactTestRenderer): string => {
  const node = byType(header(tree), 'Text').find((text) => text.props.testID === 'markdown-code-label')
  expect(node, 'the header names the block').toBeDefined()
  return node!.children.join('')
}
const copyButton = (tree: ReactTestRenderer): ReactTestInstance => {
  const found = buttonLabelled(header(tree), 'Copy code', 'Copied')
  expect(found, 'one Copy on the header').toHaveLength(1)
  return found[0]!
}
const expandButton = (tree: ReactTestRenderer): ReactTestInstance => {
  const found = buttonLabelled(header(tree), 'Expand code')
  expect(found, 'one Expand on the header').toHaveLength(1)
  return found[0]!
}
async function press(button: ReactTestInstance): Promise<void> {
  await act(async () => {
    await button.props.onPress()
  })
}
const sheetOf = (tree: ReactTestRenderer): ReactTestInstance | null => byType(tree, 'BottomDrawer')[0] ?? null

describe('the header of a fenced code block', () => {
  it.each([
    ['python', 'Python'],
    ['tsx', 'Tsx'],
    ['c', 'C'],
    ['Bash', 'Bash']
  ])('shows the fence language %s as %s', async (info, shown) => {
    expect(label(await render(fence(info, ['x'])))).toBe(shown)
  })

  it('shows "Code" for a fence with no language', async () => {
    expect(label(await render(fence('', ['pnpm test'])))).toBe('Code')
  })

  it('reads the language off the first word of a longer info string', async () => {
    expect(label(await render(fence('ts title="a.ts"', ['x'])))).toBe('Ts')
  })

  it('puts Copy then Expand on the right, after the label', async () => {
    const tree = await render(fence('sh', ['pnpm test']))
    const row = header(tree)
    const order = row
      .findAll(
        (node) =>
          (node.type as unknown) === 'Pressable' ||
          ((node.type as unknown) === 'Text' && node.props.testID === 'markdown-code-label')
      )
      .map((node) => ((node.type as unknown) === 'Pressable' ? String(node.props.accessibilityLabel) : 'label'))
    expect(order).toEqual(['label', 'Copy code', 'Expand code'])
    expect(byType(row, 'Copy' as never).length).toBeGreaterThan(0)
    expect(byType(row, 'Maximize2' as never)).toHaveLength(1)
  })

  // Claude's icon buttons are 36 sp with a 20 sp glyph and a 40 dp target
  // (bf4 "Small": a 20, c 36, d 40), 4 dp apart, 16 dp in from the card's edge.
  it('gives each icon a 36 dp button around a 20 dp glyph with a 40 dp touch target', async () => {
    const tree = await render(fence('sh', ['x']))
    for (const button of [copyButton(tree), expandButton(tree)]) {
      const style = flatStyle(
        typeof button.props.style === 'function' ? button.props.style({ pressed: false }) : button.props.style
      )
      expect(style).toMatchObject({ width: 36, height: 36 })
      expect(button.props.hitSlop).toBe(2)
    }
    expect(byType(copyButton(tree), 'Copy' as never)[0]!.props.size).toBe(20)
    expect(byType(expandButton(tree), 'Maximize2' as never)[0]!.props.size).toBe(20)
    const row = flatStyle(header(tree).props.style)
    expect(row).toMatchObject({ minHeight: 40, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' })
  })

  it.each(['light', 'dark'] as const)('draws the header and body fills, label and icons from the %s tokens', async (scheme) => {
    const want = SPEC[scheme]
    const tree = await render(fence('sh', ['pnpm test']), scheme)
    expect(flatStyle(header(tree).props.style).backgroundColor).toBe(want.header)
    const card = byId(tree, 'markdown-code-block')[0]!
    expect(flatStyle(card.props.style)).toMatchObject({ borderRadius: 12, overflow: 'hidden' })
    const body = byId(tree, 'markdown-code-body')[0]!
    expect(flatStyle(body.props.style).backgroundColor).toBe(want.body)
    // 16 dp all round, inside the sideways scroll (so a long line scrolls out
    // to the card's edge, as the app has it).
    expect(flatStyle(byType(body, 'ScrollView')[0]!.props.contentContainerStyle)).toMatchObject({ padding: 16 })
    const labelStyle = flatStyle(byType(header(tree), 'Text').find((t) => t.props.testID === 'markdown-code-label')!.props.style)
    expect(labelStyle.color).toBe(want.label)
    expect(byType(copyButton(tree), 'Copy' as never)[0]!.props.color).toBe(want.label)
    expect(byType(expandButton(tree), 'Maximize2' as never)[0]!.props.color).toBe(want.label)
    // Readable on its own fill, in both schemes.
    expect(contrastRatio(want.label, want.header)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(want.copied, want.header)).toBeGreaterThanOrEqual(3)
  })

  it('writes the label in a monospace face', async () => {
    const tree = await render(fence('sh', ['x']))
    const style = flatStyle(byType(header(tree), 'Text').find((t) => t.props.testID === 'markdown-code-label')!.props.style)
    expect(String(style.fontFamily)).toMatch(/mono/i)
    expect(style.textTransform).toBeUndefined()
  })
})

describe('Copy on the card', () => {
  it('copies the exact code, with no label, fence or line numbers', async () => {
    const lines = ['def cell(em):', '', '    return em  # a very long line '.repeat(8)]
    const tree = await render(fence('python', lines))
    await press(copyButton(tree))
    expect(pasteboard.written).toEqual([lines.join('\n')])
  })

  it('swaps the glyph to a check and says Copied for 2 s, then goes back', async () => {
    vi.useFakeTimers()
    const tree = await render(fence('sh', ['pnpm test']))
    expect(byType(copyButton(tree), 'Check' as never)).toHaveLength(0)
    await press(copyButton(tree))
    const copied = copyButton(tree)
    expect(copied.props.accessibilityLabel).toBe('Copied')
    expect(byType(copied, 'Check' as never).length).toBeGreaterThan(0)
    expect(byType(copied, 'Copy' as never)).toHaveLength(0)
    act(() => {
      vi.advanceTimersByTime(1_999)
    })
    expect(copyButton(tree).props.accessibilityLabel).toBe('Copied')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    const back = copyButton(tree)
    expect(back.props.accessibilityLabel).toBe('Copy code')
    expect(byType(back, 'Copy' as never).length).toBeGreaterThan(0)
  })

  // Claude's glyph goes to the colour `ad5.K` over 300 ms (fa20.a: tween 300,
  // "copy_icon_color"). Here the copied colour fades in over the glyph.
  it.each(['light', 'dark'] as const)('fades the glyph to the %s copied colour over 300 ms', async (scheme) => {
    const tree = await render(fence('sh', ['pnpm test']), scheme)
    await press(copyButton(tree))
    const tint = byId(copyButton(tree), 'markdown-code-copy-tint')
    expect(tint).toHaveLength(1)
    expect(byType(tint[0]!, 'Check' as never)[0]!.props.color).toBe(SPEC[scheme].copied)
    expect(flatStyle(tint[0]!.props.style).opacity).toBe(1)
    expect(mocks.timings).toContainEqual({ to: 1, duration: 300 })
  })

  it('changes colour at once, with no fade, when the phone asks for reduced motion', async () => {
    mocks.reduced = true
    const tree = await render(fence('sh', ['pnpm test']))
    await press(copyButton(tree))
    expect(flatStyle(byId(copyButton(tree), 'markdown-code-copy-tint')[0]!.props.style).opacity).toBe(1)
    expect(mocks.timings).toEqual([])
  })

  it('never says Copied, and says why, when the clipboard refuses', async () => {
    pasteboard.accepts = false
    const tree = await render(fence('sh', ['pnpm test']))
    await press(copyButton(tree))
    expect(copyButton(tree).props.accessibilityLabel).toBe('Copy code')
    expect(byType(copyButton(tree), 'Check' as never)).toHaveLength(0)
    expect(textsIn(tree.root)).toContain("Couldn't copy: the clipboard did not accept this text.")
  })
})

describe('an empty or one-line block', () => {
  it('keeps the label and offers neither Copy nor Expand on an empty block', async () => {
    const tree = await render(fence('', []))
    expect(label(tree)).toBe('Code')
    expect(buttonLabelled(header(tree), 'Copy code', 'Copied', 'Expand code')).toHaveLength(0)
    expect(pasteboard.written).toEqual([])
  })

  it('draws a one-line block as one line, with no number and no truncation note', async () => {
    const tree = await render(fence('sh', ['pnpm test']))
    const body = byId(tree, 'markdown-code-body')[0]!
    expect(textsIn(body).join('')).toBe('pnpm test')
    expect(textsIn(tree.root).some((text) => /more lines/.test(text))).toBe(false)
  })

  it('keeps the same header height while a fence is still opening', async () => {
    const tree = await render('```sh')
    expect(label(tree)).toBe('Sh')
    expect(flatStyle(header(tree).props.style).minHeight).toBe(40)
  })
})

describe('long lines in a code block', () => {
  const longLine = 'const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0) // ' + 'x'.repeat(400)

  it('scroll sideways in the card instead of wrapping, with no line-number gutter', async () => {
    const tree = await render(fence('ts', [longLine, 'return total']))
    const body = byId(tree, 'markdown-code-body')[0]!
    const scrollers = byType(body, 'ScrollView')
    expect(scrollers).toHaveLength(1)
    expect(scrollers[0]!.props.horizontal).toBe(true)
    const lines = textsIn(scrollers[0]!).join('')
    expect(lines).toContain(longLine)
    expect(lines).not.toMatch(/^\s*1\s/)
    for (const text of byType(scrollers[0]!, 'Text')) {
      expect(text.props.numberOfLines).toBeUndefined()
    }
  })

  it('keeps one line per source line, a blank line included', async () => {
    const tree = await render(fence('sh', ['a', '', 'b']))
    const runs = textsIn(byId(tree, 'markdown-code-body')[0]!)
    // One Text for the three lines, the blank one between its newlines.
    expect(byType(byId(tree, 'markdown-code-body')[0]!, 'Text').filter((t) => t.props.selectable !== undefined)).toHaveLength(1)
    expect(runs.join('')).toBe('a\n\nb')
  })

  it('puts 24 lines in a Text, so a hold selects across them', async () => {
    const lines = Array.from({ length: 50 }, (_, index) => `l${index}`)
    const tree = await render(fence('sh', lines))
    const runs = byType(byId(tree, 'markdown-code-body')[0]!, 'Text').filter((t) => t.props.selectable !== undefined)
    expect(runs.map((run) => textsIn(run).join('').split('\n').length)).toEqual([24, 24, 2])
  })
})

describe('a block too long to draw whole in the chat', () => {
  const count = MAX_MARKDOWN_CODE_LINES + 300
  const lines = Array.from({ length: count }, (_, index) => `echo ${index + 1}`)

  it('draws the first lines on the card and says how many it left out', async () => {
    const tree = await render(fence('sh', lines))
    const body = byId(tree, 'markdown-code-body')[0]!
    expect(textsIn(body).join('')).not.toContain(`echo ${count}\n`)
    expect(textsIn(tree.root)).toContain('300 more lines')
  })

  it('draws every line in the expanded sheet, and copies every line', async () => {
    const tree = await render(fence('sh', lines))
    await press(expandButton(tree))
    const sheet = sheetOf(tree)!
    const drawn = textsIn(sheet).join('')
    expect(drawn).toContain(`echo ${count}`)
    expect(drawn).toContain('echo 1\n')
    expect(textsIn(sheet).some((text) => /more lines/.test(text))).toBe(false)
    await press(buttonLabelled(sheet, 'Copy to clipboard')[0]!)
    expect(pasteboard.written).toEqual([lines.join('\n')])
  })
})

describe('the Expand sheet', () => {
  it('opens on Expand, titled "Code" for an unlabelled block, with a close cross and Copy', async () => {
    const tree = await render(fence('', ['pnpm test']))
    expect(sheetOf(tree)).toBeNull()
    await press(expandButton(tree))
    const sheet = sheetOf(tree)!
    expect(sheet).not.toBeNull()
    expect(textsIn(sheet)).toContain('Code')
    expect(buttonLabelled(sheet, 'Close')).toHaveLength(1)
    expect(byType(buttonLabelled(sheet, 'Close')[0]!, 'X' as never)).toHaveLength(1)
    expect(buttonLabelled(sheet, 'Copy to clipboard', 'Copied')).toHaveLength(1)
  })

  it('titles the sheet "<Language> code" when the fence names a language', async () => {
    const tree = await render(fence('python', ['print(1)']))
    await press(expandButton(tree))
    expect(textsIn(sheetOf(tree)!)).toContain('Python code')
  })

  it('closes on the cross', async () => {
    const tree = await render(fence('sh', ['pnpm test']))
    await press(expandButton(tree))
    expect(sheetOf(tree)).not.toBeNull()
    await press(buttonLabelled(sheetOf(tree)!, 'Close')[0]!)
    expect(sheetOf(tree)).toBeNull()
  })

  it('closes when the drawer asks to close (Back, a drag down, a tap on the scrim)', async () => {
    const tree = await render(fence('sh', ['pnpm test']))
    await press(expandButton(tree))
    const asked = mocks.sheets.at(-1)!
    await act(async () => {
      ;(asked.onClose as () => void)()
    })
    expect(sheetOf(tree)).toBeNull()
  })

  it('lets the sheet go, and the lines it built, once its exit has played', async () => {
    const tree = await render(fence('sh', ['pnpm test']))
    await press(expandButton(tree))
    await press(buttonLabelled(sheetOf(tree)!, 'Close')[0]!)
    const asked = mocks.sheets.at(-1)!
    expect(asked.visible).toBe(false)
    const drawn = mocks.sheets.length
    await act(async () => {
      ;(asked.onAfterClose as () => void)()
    })
    // No drawer is rendered for it any more.
    await act(async () => {
      tree.update(
        <ThemeProvider initialPreference="dark">
          <MobileMarkdown content={fence('sh', ['pnpm test'])} />
        </ThemeProvider>
      )
    })
    expect(mocks.sheets.length).toBe(drawn)
    // And asking again builds a fresh one.
    await press(expandButton(tree))
    expect(sheetOf(tree)).not.toBeNull()
  })

  it('copies the exact code from the sheet and shows Copied on its button', async () => {
    const lines = ['a', '', '  b\tc']
    const tree = await render(fence('sh', lines))
    await press(expandButton(tree))
    await press(buttonLabelled(sheetOf(tree)!, 'Copy to clipboard')[0]!)
    expect(pasteboard.written).toEqual([lines.join('\n')])
    const copied = buttonLabelled(sheetOf(tree)!, 'Copied')
    expect(copied).toHaveLength(1)
    expect(byType(copied[0]!, 'Check' as never).length).toBeGreaterThan(0)
  })

  it('draws the code full width, scrolling sideways, one Text per run of lines', async () => {
    const longLine = 'echo ' + 'y'.repeat(500)
    const tree = await render(fence('sh', [longLine, 'ls']))
    await press(expandButton(tree))
    const sheet = sheetOf(tree)!
    const horizontal = byType(sheet, 'ScrollView').filter((node) => node.props.horizontal === true)
    expect(horizontal).toHaveLength(1)
    expect(textsIn(horizontal[0]!).join('')).toContain(longLine)
    for (const text of byType(horizontal[0]!, 'Text')) {
      expect(text.props.numberOfLines).toBeUndefined()
    }
  })

  it('asks the drawer for a full-height sheet whose code scrolls inside it', async () => {
    const tree = await render(fence('sh', ['pnpm test']))
    await press(expandButton(tree))
    const asked = mocks.sheets.at(-1)!
    expect(asked).toMatchObject({
      visible: true,
      expandable: true,
      openingShare: 1,
      contentScrollable: false,
      // Edge to edge, and not `fillAvailable`: that lifts a full-height box by
      // the keyboard still up behind the composer (markdown-code-sheet-drawer.test.tsx).
      edgeToEdge: true,
      // Nothing to type in it: the composer's keyboard goes as it opens.
      dismissKeyboardOnOpen: true
    })
    expect(asked.fillAvailable).toBeUndefined()
    const vertical = byType(sheetOf(tree)!, 'ScrollView').filter((node) => node.props.horizontal !== true)
    expect(vertical.length).toBeGreaterThan(0)
  })

  it.each(['light', 'dark'] as const)('draws the sheet body on the %s code fill', async (scheme) => {
    const tree = await render(fence('sh', ['pnpm test']), scheme)
    await press(expandButton(tree))
    const body = byId(sheetOf(tree)!, 'markdown-code-sheet-body')[0]!
    expect(flatStyle(body.props.style).backgroundColor).toBe(SPEC[scheme].body)
  })
})
