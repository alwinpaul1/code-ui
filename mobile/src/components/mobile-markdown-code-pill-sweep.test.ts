import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMarkdown } from './MobileMarkdown'
import {
  createPhone,
  earlyLineEnds,
  overflowingLines,
  sharedLines,
  type ModelLine,
  type PhoneAs
} from './mobile-markdown-code-pill-phone.test-support'
import { resetRememberedPillCutsForTests } from './use-markdown-code-pill-runs'

/** The system font size (Settings > Display > Font size), as RN reads it,
 *  and the Android API level, which decides whether sp scale on a curve. */
const system = vi.hoisted(() => ({ fontScale: 1, api: 34 }))
vi.mock('react-native', () => ({
  Linking: { openURL: vi.fn() },
  PixelRatio: { getFontScale: () => system.fontScale },
  Platform: {
    OS: 'android',
    get Version() {
      return system.api
    }
  },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))
vi.mock('./pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))

// Sweeps of the phone model (mobile-markdown-code-pill-phone.test-support.ts)
// over widths, zooms and how the phone draws a pill against the estimate:
// narrower, wider, kerned. Each run is a fresh document, so nothing learnt in
// one reaches another. What they pin: every run settles, no two pieces of one
// span share a line, nothing runs past the edge, and no line ends more than
// 4 dp before something on the next line would have fitted.

let renderer: ReactTestRenderer | null = null
const device = createPhone(() => renderer!)
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  system.fontScale = 1
  system.api = 34
  resetRememberedPillCutsForTests()
})

/** Instrument Sans Regular GPOS kerning (uharfbuzz, 2026-09-27) for the pairs
 *  inside the code spans below, per 1000 em. The estimate leaves it out. */
const KERN: Readonly<Record<string, number>> = {
  "()": -20, "--": -49, "-c": -25, "-f": -67, "-t": -67, ".c": -52, ".e": -52, ".g": -50, ".t": -70, "/.": -127,
  "/C": -54, "/U": -31, "/a": -76, "/c": -74, "/d": -74, "/e": -74, "/s": -73, "/u": -63, "/w": -49, "06": 16,
  "32": 2, "47": -33, "60": 17, "68": 28, "AR": -20, "AT": -124, "AV": -104, "BU": 7, "C_": -82, "Co": -3,
  "DT": -61, "De": -4, "ER": -32, "ES": -43, "ET": -16, "EW": -30, "EX": -21, "E_": -38, "FO": -30, "Fe": -34,
  "Fo": -34, "G_": -78, "LT": -130, "LU": -68, "LY": -144, "L_": -30, "La": -25, "OT": -55, "OV": -39, "O_": -90,
  "PO": -7, "PU": -5, "Pi": -10, "RR": -2, "RY": -40, "R_": -18, "Ra": -17, "Re": -30, "Ru": -23, "ST": -24,
  "Sc": -2, "TA": -124, "TO": -55, "TR": -21, "T_": -111, "Te": -106, "UB": -11, "UT": -17, "Us": -14, "VA": -104,
  "Vi": -15, "WA": -102, "Y_": -125, "_A": -25, "_O": -90, "_T": -111, "_V": -140, "_W": -100, "a/": -34, "a1": -48,
  "at": -14, "ay": -22, "bi": -2, "c/": -45, "ca": -2, "cd": -2, "co": -2, "ct": -2, "e(": -11, "e-": -24,
  "e/": -46, "eC": -4, "ea": -3, "et": -6, "ew": -9, "ex": -35, "f4": -59, "fd": -18, "fi": -5, "fo": -20,
  "ha": -3, "ie": -2, "io": -2, "it": -2, "iv": -7, "ix": -16, "je": -2, "js": -2, "k-": -89, "kd": -26,
  "kt": 5, "ma": -3, "mj": -2, "n-": -45, "n/": -38, "nC": -6, "nT": -103, "na": -3, "ns": -2, "nt": -14,
  "o.": -49, "oj": -2, "ow": -10, "ox": -36, "p/": -41, "pa": 2, "pi": -2, "pt": -3, "px": -34, "r.": -101,
  "ra": -15, "rc": -18, "re": -18, "ri": -9, "rs": -15, "ru": -8, "s-": -42, "s.": -26, "s/": -28, "sc": 18,
  "se": 18, "si": 8, "ss": 10, "sx": -8, "t-": -80, "t.": -11, "t/": -13, "tS": -9, "tV": -31, "tc": -11,
  "te": -11, "to": -12, "ts": -2, "tu": -5, "ty": 11, "ud": -2, "us": -2, "ut": -3, "ve": -13, "vi": -7,
  "w.": -76, "wi": -2, "wo": -10, "ws": -7, "x/": -21, "xe": -32, "ya": -16, "yo": -13,
}

function run(content: string, width: number, as: PhoneAs = {}): string[] {
  act(() => {
    renderer = create(createElement(MobileMarkdown, { content, textScale: as.textScale ?? 1 }))
  })
  act(() => device.layOutDocument(width))
  let problems: string[]
  try {
    const { lines, lineWidth } = device.settle(width, as)
    problems = findings(lines, lineWidth, as)
  } catch (error) {
    problems = [String(error)]
  }
  act(() => renderer?.unmount())
  renderer = null
  return problems
}

function findings(lines: ModelLine[], lineWidth: number, as: PhoneAs): string[] {
  return [
    ...sharedLines(lines).map((text) => `shared "${text}"`),
    ...overflowingLines(lines, lineWidth).map((text) => `overflow ${text}`),
    ...earlyLineEnds(lines, lineWidth, as.textScale ?? 1, as.pillError ?? 1).filter((text) => {
      const gap = /left ([\d.]+) dp for .* \(([\d.]+) dp\)/.exec(text)
      return gap ? Number(gap[1]) - Number(gap[2]) > 4 : true
    })
  ]
}

const WORKTREE =
  '- Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows`. Branch `fix/chat-rows`, commits `68a160e5` and `06b32d5e` on top of `main` `4f46fd47`.'

// Review of f8c968a1, probes F1 and F2: one scale per Text, learnt from
// whichever lone pill read widest. A pill of arrows, which the estimate
// priced at 600 against the font's 850, set the scale for the path pill
// beside it, which then ended its lines early; the next layout showed another
// lone pill, the scale fell, and the cut swung between the two until the
// round cap froze it on the bad one.
describe('a pill of arrows beside a path', () => {
  const arrows = (tag: string) =>
    `The states go \`idle→queued→running→done→archived→idle→queued→running→done→archived→idle→queued\` and the worktree is \`/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows/mobile/src/components/${tag}\` for now.`
  it.each([300, 320, 340, 360, 380, 400])('settles whole at %i dp', (width) => {
    expect(run(arrows(`arrows-${width}`), width)).toEqual([])
  })
})

// Review of f8c968a1, probes H1 to H3: two pieces of one span stayed side by
// side at an exact estimate, 15 of 864 runs. A piece cut for the whole line
// went down a line, and the room it landed in (93 dp) was taken as the room it
// had failed at, so its first piece was capped there for good.
describe('pills drawn exactly as estimated', () => {
  it('never leave two pieces of one span on one line, at any width', () => {
    const found: string[] = []
    for (let extra = 0; extra < 24; extra += 3) {
      for (let width = 280; width <= 440; width += 4) {
        const content = WORKTREE.replace('chat-rows`', `chat-rows${'-x'.repeat(extra)}\``)
        found.push(...run(content, width).map((problem) => `extra ${extra} @${width}: ${problem}`))
      }
    }
    expect(found).toEqual([])
  })
})

// Review of f8c968a1, probes K1 and K2: the phone kerns and the estimate does
// not (HarfBuzz ratios 0.917 to 1.0 for these spans), and the scale learnt
// from one lone pill swung against another's.
describe('kerned pills', () => {
  const KERNED = [
    WORKTREE,
    'Run `cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint && node scripts/check-tests-typecheck-ratchet.mjs` before committing.',
    'The hook `useMarkdownCodePillRuns` reads `onTextLayout` through `PixelRatio.getFontScale()` and writes `AVATAR_TYPE_WAVY_LTR_VALUE_TOTAL_WIDTH_ATTRIBUTE_FOR_THE_VIEW` to `mobile/src/components/use-markdown-code-pill-runs.ts` today.',
    'See `a/b` and `c/d/e` then `mobile/src/session/use-mobile-chat-following-controller.ts` and `x` and `mobile/src/session/MobileNativeChatView.tsx`.',
    'Set `EXPO_PUBLIC_TELEMETRY_ENDPOINT_OVERRIDE_VALUE_FOR_TESTING_ONLY` and `ReactNativeFeatureFlags.enablePreparedTextLayout` then `yarn`.'
  ]
  it('settle whole without swinging, at every width', () => {
    const found: string[] = []
    KERNED.forEach((content, index) => {
      for (let width = 260; width <= 440; width += 6) {
        found.push(...run(`${content} (${width})`, width, { kern: KERN }).map((problem) => `${index} @${width}: ${problem}`))
      }
    })
    expect(found).toEqual([])
  })
})

// A sweep of the model the review ran against f8c968a1 (G1), smaller: six
// paragraphs, four zooms, pills drawn 10% narrower, as estimated, and 10%
// wider, and a width every 24 dp.
describe('the phone model swept', () => {
  const CONTENTS = [
    WORKTREE,
    'Run `cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint && node scripts/check-tests-typecheck-ratchet.mjs` before committing.',
    'The review probes are in `/private/tmp/claude-501/-Users-alwinpaul-Desktop-Project-Code-UI/790eafa8-07b2-4380-abc2-90e22f965369/scratchpad/chat-rows-review-probes/`. Copy them in.',
    '> The fix lives in `mobile/src/components/use-markdown-code-pill-runs.ts` and `mobile/src/components/mobile-markdown-code-pill-fit.ts`, both.',
    'See `a/b` and `c/d/e` then `mobile/src/session/use-mobile-chat-following-controller.ts` and `x` and `mobile/src/session/MobileNativeChatView.tsx`.',
    '1. First `packages/some-package/src/index.ts`\n2. Second `packages/another-package/src/components/Thing.tsx` done'
  ]
  it.each([0.8, 1, 1.3, 1.6])('settles whole at zoom %s', (textScale) => {
    const found: string[] = []
    CONTENTS.forEach((base, index) => {
      for (const pillError of [0.9, 1, 1.1]) {
        for (let width = 260; width <= 440; width += 24) {
          // Unique per run so no remembered cut carries between phones.
          const content = base.replace(/`([^`]*\/[^`]*)`/, (_m, code: string) => `\`${code}-${textScale}-${pillError}-${width}\``)
          found.push(...run(content, width, { pillError, textScale }).map((problem) => `${index} x${pillError} @${width}: ${problem}`))
        }
      }
    })
    expect(found).toEqual([])
  })
})

// Review of 12e3b98e (probe R4-FE): on a fresh phone at one width, pills the
// phone draws wider than the estimate (a larger system font size, a fallback
// font, hinting) settled with a span's first two pieces side by side on the
// line below the one they were cut to fill, 14 of 648 runs at 3% wider, 40
// at 10% and 61 at 30%, widths from 300 to 820 dp. Every line end counts
// here, not only those more than 4 dp early.
describe('pills drawn wider than estimated, on a fresh phone', () => {
  const PARAGRAPHS = [
    'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows`. Branch `fix/chat-rows`, commits `68a160e5` and `06b32d5e` on top of `main` `4f46fd47`.',
    'the fix lives in `mobile/src/components/use-markdown-code-pill-runs.ts` and `mobile/src/components/mobile-markdown-code-pill-fit.ts`, both of them.',
    'run `cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint && node scripts/check-tests-typecheck-ratchet.mjs` before committing.'
  ]
  const LEAD = 'I checked this again after the last review and it reads the same way on the phone as on the desktop today'.split(' ')

  it.each([
    ['I checked this the fix lives in `mobile/src/components/use-markdown-code-pill-runs.ts` and `mobile/src/components/mobile-markdown-code-pill-fit.ts`, both of them.'],
    ['I checked this again after the last review and Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows`. Branch `fix/chat-rows`, commits `68a160e5` and `06b32d5e` on top of `main` `4f46fd47`.']
  ])('keeps a span off the line below its first piece, drawn 3 per cent wider at 800 dp: %s', (content) => {
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content }))
    })
    act(() => device.layOutDocument(800))
    const { lines, lineWidth } = device.settle(800, { pillError: 1.03 })
    expect([...sharedLines(lines), ...earlyLineEnds(lines, lineWidth, 1, 1.03)]).toEqual([])
  })

  // At phone widths a span tried whole while its scale was a guess ran past
  // its line's edge, was read as if cut to fit it, and read 5% too wide: two
  // of its pieces then fitted side by side, or a line ended early.
  it.each([
    [1, 3, 372, 1.15],
    [1, 18, 372, 1.1]
  ])('settles whole at a phone width: paragraph %i after %i words at %i dp, drawn x%s', (index, words, width, pillError) => {
    const content = `${LEAD.slice(0, words).join(' ')} ${PARAGRAPHS[index]!}`
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content }))
    })
    act(() => device.layOutDocument(width))
    const { lines, lineWidth } = device.settle(width, { pillError })
    expect([...sharedLines(lines), ...overflowingLines(lines, lineWidth), ...earlyLineEnds(lines, lineWidth, 1, pillError)]).toEqual([])
  })

  it.each([1.03, 1.05, 1.1, 1.15, 1.3])('settles whole, drawn x%s, at every width', (pillError) => {
    const found: string[] = []
    PARAGRAPHS.forEach((base, index) => {
      for (let n = 0; n <= LEAD.length; n += 3) {
        const content = `${LEAD.slice(0, n).join(' ')}${n ? ' ' : ''}${base}`
        for (let width = 300; width <= 820; width += 20) {
          act(() => {
            renderer = create(createElement(MobileMarkdown, { content }))
          })
          act(() => device.layOutDocument(width))
          const { lines, lineWidth } = device.settle(width, { pillError })
          const problems = [
            ...sharedLines(lines).map((text) => `shared "${text}"`),
            ...overflowingLines(lines, lineWidth),
            ...earlyLineEnds(lines, lineWidth, 1, pillError)
          ]
          found.push(...problems.map((problem) => `${index} n${n} @${width}: ${problem}`))
          act(() => renderer?.unmount())
          renderer = null
          resetRememberedPillCutsForTests()
        }
      }
    })
    expect(found).toEqual([])
  })
})

// The same paragraphs at a larger system font size. Android scales sp
// through a curve from Android 14 on (FontScaleConverterFactory: at 130%,
// 14 sp is 18.8 dp and 15 sp 19.5), so a pill's text is drawn a few per cent
// wider again than the prose beside it is scaled.
describe('pills at a larger system font size, on a fresh phone', () => {
  const PARAGRAPHS = [
    'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows`. Branch `fix/chat-rows`, commits `68a160e5` and `06b32d5e` on top of `main` `4f46fd47`.',
    'the fix lives in `mobile/src/components/use-markdown-code-pill-runs.ts` and `mobile/src/components/mobile-markdown-code-pill-fit.ts`, both of them.',
    'run `cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint && node scripts/check-tests-typecheck-ratchet.mjs` before committing.'
  ]
  const LEAD = 'I checked this again after the last review and it reads the same way on the phone as on the desktop today'.split(' ')

  it.each([
    [1.15, 1.015],
    [1.3, 1.035]
  ])('settles whole at %s, pill text drawn x%s beyond it, at every width', (fontScale, pillError) => {
    system.fontScale = fontScale
    const as = { fontScale, pillError, placeholder: { system: fontScale, curve: true } }
    const found: string[] = []
    PARAGRAPHS.forEach((base, index) => {
      for (let n = 0; n <= LEAD.length; n += 6) {
        const content = `${LEAD.slice(0, n).join(' ')}${n ? ' ' : ''}${base}`
        for (let width = 300; width <= 820; width += 40) {
          act(() => {
            renderer = create(createElement(MobileMarkdown, { content }))
          })
          act(() => device.layOutDocument(width))
          const { lines, lineWidth } = device.settle(width, as)
          const problems = [
            ...sharedLines(lines).map((text) => `shared "${text}"`),
            ...overflowingLines(lines, lineWidth),
            ...earlyLineEnds(lines, lineWidth, 1, pillError, fontScale, as.placeholder)
          ]
          found.push(...problems.map((problem) => `${index} n${n} @${width}: ${problem}`))
          act(() => renderer?.unmount())
          renderer = null
          resetRememberedPillCutsForTests()
        }
      }
    })
    expect(found).toEqual([])
  })
})

// Review of 63858e9e (F1): Android 14 turns sp into dp through a curve
// (FontScaleConverterFactory), so at 200% the prose (15 sp) is drawn at 27 dp
// and a pill's text (14 sp) at 26, where PixelRatio.getFontScale() says 2.
// Priced linearly, at 30, the words beside a pill read 11% wider than drawn:
// a path pill went down a line and left up to 700 dp empty above it. The
// model draws prose and pill text at the curve's sizes; a pill's text is
// kerned 3% narrower on top, or 3% wider.
describe('pills at a large system font size on Android 14', () => {
  const PARAGRAPHS = [
    'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows`. Branch `fix/chat-rows`, commits `68a160e5` and `06b32d5e` on top of `main` `4f46fd47`.',
    'the fix lives in `mobile/src/components/use-markdown-code-pill-runs.ts` and `mobile/src/components/mobile-markdown-code-pill-fit.ts`, both of them.',
    'run `cd mobile && npx tsc --noEmit && npx vitest run && npx oxlint && node scripts/check-tests-typecheck-ratchet.mjs` before committing.'
  ]
  const LEAD = 'I checked this again after the last review and it reads the same way on the phone as on the desktop today'.split(' ')
  /** The curve's dp for 15 sp and 14 sp at each scale (the AOSP tables). */
  const CURVE: Readonly<Record<string, readonly [number, number]>> = { '1.5': [22.5, 22], '1.8': [25.2, 24.4], '2': [27, 26] }
  const drawnAt = (system: string, kern: number) => {
    const [prose, pill] = CURVE[system]!
    return {
      fontScale: prose / 15,
      pillError: (pill / 14 / (prose / 15)) * kern,
      placeholder: { system: Number(system), curve: true }
    }
  }

  it.each([860, 880, 780])('fills the line before a path pill at 200 per cent, %i dp', (width) => {
    system.fontScale = 2
    const as = drawnAt('2', 0.97)
    act(() => {
      renderer = create(createElement(MobileMarkdown, { content: PARAGRAPHS[1]! }))
    })
    act(() => device.layOutDocument(width))
    const { lines, lineWidth } = device.settle(width, as)
    expect([...sharedLines(lines), ...earlyLineEnds(lines, lineWidth, 1, as.pillError, as.fontScale, as.placeholder)]).toEqual([])
  })

  it.each([
    ['1.5', 0.97],
    ['1.8', 1],
    ['2', 0.97],
    ['2', 1.03]
  ])('settles whole at %s, pill text kerned x%s, at every width', (scale, kern) => {
    system.fontScale = Number(scale)
    const as = drawnAt(scale, kern)
    const found: string[] = []
    PARAGRAPHS.forEach((base, index) => {
      for (let n = 0; n <= LEAD.length; n += 6) {
        const content = `${LEAD.slice(0, n).join(' ')}${n ? ' ' : ''}${base}`
        for (let width = 300; width <= 900; width += 40) {
          act(() => {
            renderer = create(createElement(MobileMarkdown, { content }))
          })
          act(() => device.layOutDocument(width))
          const { lines, lineWidth } = device.settle(width, as)
          const problems = [
            ...sharedLines(lines).map((text) => `shared "${text}"`),
            ...overflowingLines(lines, lineWidth),
            ...earlyLineEnds(lines, lineWidth, 1, as.pillError, as.fontScale, as.placeholder)
          ]
          found.push(...problems.map((problem) => `${index} n${n} @${width}: ${problem}`))
          act(() => renderer?.unmount())
          renderer = null
          resetRememberedPillCutsForTests()
        }
      }
    })
    expect(found).toEqual([])
  })
})

// Review of 63858e9e (F3): RN sizes an inline view's placeholder with
// toPixelFromSP of the view's frame (TextLayoutManager.kt), so at a system
// font size a pill takes more room on its line than it draws: 30% more at
// 130% up to Android 13, and on Android 14's curve a short pill much more
// and one of 100 dp or wider none. Priced at its frame, a pill cut to fill a
// line did not fit it, and one cut for the room after words went down.
describe("pills at a system font size, with the room RN reserves for them", () => {
  const PARAGRAPHS = [
    'Worktree: `/Users/alwinpaul/Desktop/Project/Code UI/.claude/worktrees/chat-rows`. Branch `fix/chat-rows`, commits `68a160e5` and `06b32d5e` on top of `main` `4f46fd47`.',
    'the fix lives in `mobile/src/components/use-markdown-code-pill-runs.ts` and `mobile/src/components/mobile-markdown-code-pill-fit.ts`, both of them.',
    'Run `pnpm install` and `pnpm test` then `git push` to finish, with `a/b` and `x` beside them.'
  ]
  const LEAD = 'I checked this again after the last review and it reads the same way on the phone as on the desktop today'.split(' ')
  /** The curve's dp for 15 sp and 14 sp at each scale (the AOSP tables). */
  const CURVE: Readonly<Record<string, readonly [number, number]>> = { '1.3': [19.5, 18.8], '2': [27, 26] }

  it.each([
    ['Android 13', 33, 1.15, 1],
    ['Android 13', 33, 1.3, 1],
    ['Android 13', 33, 1.3, 1.03],
    ['Android 14', 34, 1.3, 1],
    ['Android 14', 34, 2, 0.97],
    ['Android 14', 34, 2, 1.03]
  ] as const)('settles whole on %s (API %i) at %s, pill text kerned x%s, at every width', (_name, api, scale, kern) => {
    system.api = api
    system.fontScale = scale
    const curve = api >= 34
    const [prose, pill] = curve ? CURVE[String(scale)]! : [15 * scale, 14 * scale]
    const as = {
      fontScale: prose / 15,
      pillError: (pill / 14 / (prose / 15)) * kern,
      placeholder: { system: scale, curve }
    }
    const found: string[] = []
    PARAGRAPHS.forEach((base, index) => {
      for (let n = 0; n <= LEAD.length; n += 6) {
        const content = `${LEAD.slice(0, n).join(' ')}${n ? ' ' : ''}${base}`
        for (let width = 300; width <= 900; width += 40) {
          act(() => {
            renderer = create(createElement(MobileMarkdown, { content }))
          })
          act(() => device.layOutDocument(width))
          const { lines, lineWidth } = device.settle(width, as)
          const problems = [
            ...sharedLines(lines).map((text) => `shared "${text}"`),
            ...overflowingLines(lines, lineWidth),
            ...earlyLineEnds(lines, lineWidth, 1, as.pillError, as.fontScale, as.placeholder)
          ]
          found.push(...problems.map((problem) => `${index} n${n} @${width}: ${problem}`))
          act(() => renderer?.unmount())
          renderer = null
          resetRememberedPillCutsForTests()
        }
      }
    })
    expect(found).toEqual([])
  })
})
