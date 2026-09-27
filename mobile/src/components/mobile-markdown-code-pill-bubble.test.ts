import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Prose } from '../session/MobileNativeChatProse'
import { makeChatMessageStyles } from '../session/mobile-native-chat-message-styles'
import type { Theme } from '../theme/theme-context'
import { syntaxPaletteForScheme } from '../theme/syntax-palette'
import { darkColors, fontFamily, lightColors, radius, space, type } from '../theme/tokens'
import { createPhone, earlyLineEnds, overflowingLines, sharedLines, type ModelLine } from './mobile-markdown-code-pill-phone.test-support'
import { resetRememberedPillCutsForTests } from './use-markdown-code-pill-runs'

vi.mock('react-native', () => ({
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

// A prompt the lead agent wrote, drawn as Markdown in a user bubble (a
// subagent's transcript, promptsAsMarkdown). The bubble is as wide as its
// text up to its max, and RN Android measures a Text that way AT_MOST
// (the phone model's atMost): one that wraps is exactly as wide as the max,
// one that does not is as wide as its one line.

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

/** The prompt bubble's text, drawn by the chat as it draws a lead's prompt. */
function mountPrompt(text: string, scheme: 'light' | 'dark' = 'light') {
  act(() => {
    renderer = create(
      createElement(Prose, {
        block: { type: 'text', text },
        invert: true,
        markdownPrompt: true,
        fontScale: 1,
        styles: makeChatMessageStyles(themeFor(scheme)),
        identity: 'u1:0:0'
      })
    )
  })
}

function whole(lines: ModelLine[], lineWidth: number): string[] {
  return [...sharedLines(lines), ...overflowingLines(lines, lineWidth), ...earlyLineEnds(lines, lineWidth)]
}

// Review of 12e3b98e (probe B1b): the bubble's Texts were keyed without their
// width, on the belief that a bubble narrows to its widest line as its pills
// settle. RN measures a wrapped Text as wide as the max, so a bubble's width
// only moves with its max: a rotation or a split screen. The tree drawn at
// the old width was laid out at the new one and reported to the handler cut
// for the old, which refused it, and nothing followed: the pill stayed cut
// for 309 dp in a 688 dp bubble, with the line before it ended early.
describe('a prompt bubble turned to landscape', () => {
  it.each(['light', 'dark'] as const)('fills its lines at the new width, in %s', (scheme) => {
    const text =
      'the quick brown fox jumps over a lazy dog while reading notes about builds and the quick brown fox jumps over a lazy dog while reading notes about builds and the quick brown fox jumps over a lazy dog while reading notes about builds and the quick brown fox jumps over a lazy dogxxxxxxx `src/components/zz-69/pill-runs.ts` then more words to finish the paragraph off here.'
    mountPrompt(text, scheme)
    expect(device.settleBubble(309).width).toBe(309)
    expect(device.settleBubble(688).width).toBe(688)
    const { lines, lineWidth } = device.settle(688)
    expect(whole(lines, lineWidth)).toEqual([])
  })
})

// Review of 12e3b98e (probe S3): a bubble whose widest line is a lone code
// span is as wide as that pill, rounded up. The span must clear its line by
// FIT_SLACK, so at that width it was cut in two; the two pieces side by side
// made the bubble wider, where the span fitted whole again, and the bubble
// swung between the two widths (89 and 97 dp for `pnpm install`) for as long
// as it was on screen.
describe('a prompt bubble as wide as its one line', () => {
  it.each([
    ['`pnpm install`', 1],
    ['`pnpm install`', 0.97],
    ['`pnpm install`', 1.03],
    // Kerned: HarfBuzz draws some spans 8% narrower than the advances sum.
    ['`pnpm install`', 0.92],
    ['`pnpm install`', 0.9],
    ['`AVATAR_TYPE_WAVY`', 0.92],
    ['`x`', 1],
    ['Run `pnpm install` now.', 1],
    ['Run `pnpm install` now.', 0.97],
    ['Please run\n\n`pnpm install --frozen-lockfile`', 1],
    ['Please run\n\n`pnpm install --frozen-lockfile`', 0.97],
    ['Run `cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint` then report.', 1]
  ] as const)('%s settles on one width, pills drawn x%s', (text, pillError) => {
    mountPrompt(text)
    const { width, widths } = device.settleBubble(309, { pillError })
    expect(widths.length).toBeLessThanOrEqual(3)
    expect(width).toBeGreaterThan(0)
    const { lines, lineWidth } = device.settle(width, { pillError })
    expect([...sharedLines(lines), ...overflowingLines(lines, lineWidth)]).toEqual([])
  })
})

// Review of 63858e9e: a bubble whose widest line is a list item or words
// ending in a long path, drawn 8 to 14% narrower than estimated, swung
// forever (65 of 540 in the review's sweep), remounting its Text at every
// step. As wide as the whole path drawn, the bubble had no room for it by
// the estimate, so it was cut in two; the two side by side, after the
// bullet, made the bubble wider, where the path fitted whole and read as
// settled; back at the narrower width nothing of that was known. The two
// pieces on the line after the bullet were not read at all.
describe('a prompt bubble whose widest line is a list item or words ending in a path', () => {
  const TEXTS = [
    '- `one`\n- `two/three`\n- `mobile/src/components/use-markdown-code-pill-runs.ts`',
    '- `mobile/src/components/mobile-markdown-code-pill-fit.ts`',
    'Use `mobile/src/components/use-markdown-code-pill-runs.ts`',
    'See `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/code-pills`',
    '1. `packages/some-package/src/components/Thing.tsx`'
  ]
  it.each([0.86, 0.9, 0.92, 0.95])('settles on one width with its pills drawn x%s', (pillError) => {
    const found: string[] = []
    TEXTS.forEach((text, index) => {
      for (const max of [360, 400, 602]) {
        mountPrompt(text)
        const { width, widths } = device.settleBubble(max, { pillError })
        if (width === -1) {
          found.push(`${index} max ${max}: never holds, ${widths.slice(0, 4).join(' ')}`)
        } else {
          const { lines, lineWidth } = device.settle(width, { pillError })
          found.push(...[...sharedLines(lines), ...overflowingLines(lines, lineWidth)].map((problem) => `${index} max ${max}: ${problem}`))
        }
        act(() => renderer?.unmount())
        renderer = null
        resetRememberedPillCutsForTests()
      }
    })
    expect(found).toEqual([])
  })
})
