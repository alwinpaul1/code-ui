import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Prose } from '../session/MobileNativeChatProse'
import { makeChatMessageStyles } from '../session/mobile-native-chat-message-styles'
import type { Theme } from '../theme/theme-context'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import { createPhone, earlyLineEnds, overflowingLines, sharedLines, type ModelLine } from './mobile-markdown-code-pill-phone.test-support'
import { TRANSCRIPT_MARKDOWN_TYPOGRAPHY } from './mobile-markdown-prose-scale'
import { resetRememberedPillCutsForTests } from './use-markdown-code-pill-runs'

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Image: 'Image',
  Linking: { openURL: vi.fn() },
  PixelRatio: { getFontScale: () => 1 },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 360, height: 800, scale: 2.625, fontScale: 1 })
}))
vi.mock('lucide-react-native', () => ({ Image: 'ImageIcon' }))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

// 2026-10-09: the chat transcript sets its inline code in JetBrains Mono
// (TRANSCRIPT_MARKDOWN_TYPOGRAPHY), every glyph 0.6 em, where a pill was set
// in Instrument Sans and cut by its advances. Cut by the old advances, a
// mono pill is priced far narrower than it is drawn (four `i` 11.5 dp
// against 28.8) and runs past its line. Through the phone model: each pill
// fills the room left on its line, none runs past it, and no two share one.

let renderer: ReactTestRenderer | null = null
const device = createPhone(() => renderer!)
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  resetRememberedPillCutsForTests()
})

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

/** An agent's reply, drawn by the chat as it draws one. */
function mountReply(text: string, scheme: 'light' | 'dark') {
  act(() => {
    renderer = create(
      createElement(Prose, {
        block: { type: 'text', text },
        fontScale: 1,
        styles: makeChatMessageStyles(themeFor(scheme)),
        identity: 'a1:0:0'
      })
    )
  })
}

/** The transcript's pill and prose, for the early-line-end check. */
const TYPE = {
  pillSize: TRANSCRIPT_MARKDOWN_TYPOGRAPHY.chip.fontSize,
  pillFamily: fontFamily.mono,
  proseSize: TRANSCRIPT_MARKDOWN_TYPOGRAPHY.prose.fontSize
}

function problems(lines: ModelLine[], lineWidth: number, pillError: number): string[] {
  return [
    ...sharedLines(lines),
    ...overflowingLines(lines, lineWidth),
    ...earlyLineEnds(lines, lineWidth, 1, pillError, 1, undefined, TYPE)
  ]
}

const REPLIES = [
  'The full PR text is in `scratchpad/orca-context-pr.md`. It is titled for the paired mobile clients.',
  'One finding changes what you will see. The `68.3k/1.0M` row is not printed by your status line script.',
  'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/agent-a5c70049777b81313/mobile` and more words.',
  'Run `iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii` then `mmmm`.',
  '`x`'
]

describe('a transcript reply’s mono pills', () => {
  it.each(['light', 'dark'] as const)('fill their lines and never run past them, in %s', (scheme) => {
    const found: string[] = []
    REPLIES.forEach((text, index) => {
      for (const width of [320, 360, 412]) {
        for (const pillError of [0.95, 1, 1.03]) {
          mountReply(text, scheme)
          act(() => device.layOutDocument(width))
          const { lines, lineWidth } = device.settle(width, { pillError })
          found.push(...problems(lines, lineWidth, pillError).map((problem) => `${index} at ${width} x${pillError}: ${problem}`))
          act(() => renderer?.unmount())
          renderer = null
          resetRememberedPillCutsForTests()
        }
      }
    })
    expect(found).toEqual([])
  })
})
