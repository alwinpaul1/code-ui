import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { cloneElement, type ReactElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 2026-10-14, Phase 1 of the Claude-app UI port ("we need all the things from
// claude decompiled to here"). The Claude Android app (1.261009.20) draws
// every sheet through one Material 3 ModalBottomSheet wrapper, so its sheets
// share corners, ground, grabber and scrim. Code UI had two sheet families
// that agreed on none of it: BottomDrawer had a 24 dp corner (over a 16 dp one
// left in its stylesheet), a grey `textMuted` bar at 40% and the warm 42% /
// black 55% `bgOverlay`; DraggableDetailSheet had its own copy of each. These
// pin the one look (sheet-spec.ts) in both schemes, through both families,
// with a ratchet that keeps a new sheet from drifting off it. The MOTION is
// 0.9.139's, by the user's choice (see the motion pins below).

const mocks = vi.hoisted(() => ({
  scheme: 'light' as 'light' | 'dark',
  reduced: false,
  springs: [] as { to: number; config: unknown }[],
  timings: [] as { to: number; duration: number | undefined }[]
}))

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    addEventListener: () => ({ remove: () => {} }),
    isReduceMotionEnabled: () => Promise.resolve(mocks.reduced)
  },
  BackHandler: { addEventListener: () => ({ remove: () => {} }) },
  Keyboard: {
    addListener: () => ({ remove: () => {} }),
    dismiss: () => {},
    metrics: () => null
  },
  Modal: 'Modal',
  Platform: { OS: 'android', select: (options: { android?: unknown }) => options.android },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {}, hairlineWidth: 1 },
  View: 'View',
  useWindowDimensions: () => ({ width: 412, height: 956 })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 })
}))
vi.mock('react-native-gesture-handler', () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: { Pan: () => chain, Native: () => chain },
    GestureDetector: 'GestureDetector',
    GestureHandlerRootView: 'GestureHandlerRootView'
  }
})
vi.mock('react-native-reanimated', async () => {
  const React = await import('react')
  return {
    default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
    useSharedValue: (initial: number) => React.useRef({ value: initial }).current,
    useAnimatedStyle: <T,>(factory: () => T) => factory(),
    useAnimatedScrollHandler: () => () => {},
    useAnimatedRef: () => ({ current: null }),
    scrollTo: () => {},
    withSpring: (to: number, config?: unknown) => {
      mocks.springs.push({ to, config })
      return to
    },
    withTiming: (to: number, config?: { duration?: number }) => {
      mocks.timings.push({ to, duration: config?.duration })
      return to
    },
    runOnJS: (fn: () => void) => fn,
    interpolate: (value: number, input: [number, number], output: [number, number]) => {
      const t = Math.min(Math.max((value - input[0]) / (input[1] - input[0]), 0), 1)
      return output[0] + (output[1] - output[0]) * t
    },
    Extrapolation: { CLAMP: 'clamp' }
  }
})
vi.mock('lucide-react-native', () => ({ X: 'X' }))
vi.mock('../navigation/use-back-claim', () => ({ useBackClaim: () => {} }))
vi.mock('../theme/theme-context', async () => {
  const { darkColors, lightColors } = await import('../theme/tokens')
  const theme = () => ({ colors: mocks.scheme === 'dark' ? darkColors : lightColors })
  return {
    useTheme: theme,
    useThemedStyles: <T,>(factory: (value: ReturnType<typeof theme>) => T) => factory(theme())
  }
})
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => mocks.reduced }))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false, modalMaxWidth: 640 })
}))
vi.mock('./bottom-drawer-modal-host', () => ({ useInsideBottomDrawerModalHost: () => true }))

import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { DraggableDetailSheet } from './DraggableDetailSheet'
import { MountedBottomDrawer } from './mounted-bottom-drawer'
import { M3_STANDARD_MOTION, SHEET_SPEC, sheetColors } from './sheet-spec'

const SCHEMES = [
  ['light', lightColors],
  ['dark', darkColors]
] as const

let renderer: ReactTestRenderer | null = null

beforeEach(() => {
  mocks.scheme = 'light'
  mocks.reduced = false
  mocks.springs.length = 0
  mocks.timings.length = 0
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...([] as unknown[]).concat(style ?? []).flat(Infinity).filter(Boolean))
}

/** Mount, report the sheet's layout (a bottom drawer's open waits for it),
 *  then render once more so the style worklet sees the effect's writes. */
async function render(element: ReactElement): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(element)
  })
  const [laidOut] = renderer!.root.findAll(
    (node) => typeof node.type === 'string' && node.props.testID === 'bottom-drawer-sheet'
  )
  act(() => {
    laidOut?.props.onLayout?.({ nativeEvent: { layout: { x: 0, y: 0, width: 412, height: 300 } } })
  })
  await act(async () => {
    renderer!.update(cloneElement(element))
  })
  return renderer!
}

const bottomDrawer = (expandable: boolean, visible = true): ReactElement => (
  <MountedBottomDrawer visible={visible} onClose={() => {}} onHidden={() => {}} expandable={expandable}>
    {null}
  </MountedBottomDrawer>
)
const detailSheet = (visible = true): ReactElement => (
  <DraggableDetailSheet visible={visible} onClose={() => {}} header={null}>
    {null}
  </DraggableDetailSheet>
)

/** Each family, and what it does under reduced motion in 0.9.139: the bottom
 *  drawer fades on its open timing, the tool-detail sheet appears at once. */
const FAMILIES = [
  ['the bottom drawer', (visible?: boolean) => bottomDrawer(false, visible), 'bottom-drawer-sheet', 'fade'],
  ['the tool-detail sheet', detailSheet, 'draggable-detail-sheet', 'instant']
] as const

function sheetOf(root: ReactTestInstance, testID: string): Record<string, unknown> {
  const [node] = root.findAll((candidate) => typeof candidate.type === 'string' && candidate.props.testID === testID)
  expect(node, `${testID} did not render`).toBeDefined()
  return flatten(node!.props.style)
}

/** Every drawn grabber bar: a 36-wide, 5-tall view with a fill. */
function grabbers(root: ReactTestInstance): Record<string, unknown>[] {
  return root
    .findAll((node) => String(node.type) === 'View')
    .map((node) => flatten(node.props.style))
    .filter((style) => style.width === SHEET_SPEC.handle.width && style.height === SHEET_SPEC.handle.height && style.backgroundColor)
}

function scrimsOf(root: ReactTestInstance, colors: ThemeColors): Record<string, unknown>[] {
  return root
    .findAll((node) => String(node.type) === 'AnimatedView')
    .map((node) => flatten(node.props.style))
    .filter((style) => style.backgroundColor === colors.sheetScrim)
}

describe('the sheet spec, as decompiled from the Claude app 1.261009.20', () => {
  it('has the 44 dp top corners and the 36 × 5 grabber with its 6 / 5.5 padding', () => {
    expect(SHEET_SPEC.radius).toBe(44)
    expect(SHEET_SPEC.handle).toEqual({ width: 36, height: 5, borderRadius: 2.5, paddingHorizontal: 6, paddingVertical: 5.5 })
  })

  it.each(SCHEMES)('maps the app’s sheet colours onto %s tokens', (_scheme, colors) => {
    const resolved = sheetColors(colors)
    expect(resolved.container).toBe(colors.chatBg)
    expect(resolved.handle).toBe(colors.composerBorder)
    expect(resolved.scrim).toBe('rgba(0, 0, 0, 0.32)')
    expect(resolved.content).toBe(colors.text)
  })

  it('pins the exact app colours in both schemes, not just the token names', () => {
    expect(sheetColors(lightColors)).toMatchObject({ container: '#F9F9F7', handle: 'rgba(30, 30, 29, 0.15)' })
    expect(sheetColors(darkColors)).toMatchObject({ container: '#151515', handle: 'rgba(225, 224, 217, 0.15)' })
  })

  // 2026-10-14: Claude's M3 springs were ported and rejected by the user the
  // same day ("We need it smooth same as we have in latest release"). The
  // sheets move exactly as in 0.9.139 (237ce4dca); these are those values.
  it('moves as 0.9.139 did, not on the Claude app’s springs', () => {
    expect(SHEET_SPEC.motion.openMs).toBe(180)
    expect(SHEET_SPEC.motion.hideMs).toBe(150)
    expect(SHEET_SPEC.motion.settle).toEqual({ stiffness: 400, damping: 40, mass: 1 })
    expect(SHEET_SPEC.motion.scrimFollowsOpen).toBe(true)
    // Kept for reference only.
    expect(M3_STANDARD_MOTION.defaultSpatial).toEqual({ dampingRatio: 0.9, stiffness: 700 })
  })
})

describe.each(SCHEMES)('every sheet family in %s mode', (scheme, colors) => {
  beforeEach(() => {
    mocks.scheme = scheme
  })

  it.each(FAMILIES)('%s draws the 44 dp corners on the screen ground', async (_name, element, testID) => {
    const root = (await render(element())).root
    const sheet = sheetOf(root, testID)
    expect(sheet.borderTopLeftRadius).toBe(44)
    expect(sheet.borderTopRightRadius).toBe(44)
    expect(sheet.backgroundColor).toBe(colors.chatBg)
  })

  it.each(FAMILIES)('%s dims the screen with the 32% black scrim', async (_name, element) => {
    const root = (await render(element())).root
    expect(scrimsOf(root, colors)).toHaveLength(1)
  })

  it('the tool-detail sheet, which has a half-height rest, draws the hairline grabber', async () => {
    const root = (await render(detailSheet())).root
    const bars = grabbers(root)
    expect(bars).toHaveLength(1)
    expect(bars[0]).toMatchObject({ backgroundColor: colors.composerBorder, borderRadius: 2.5 })
    expect(bars[0]!.opacity ?? 1).toBe(1)
  })

  it('an expandable bottom drawer, which opens part way, draws the same grabber', async () => {
    const root = (await render(bottomDrawer(true))).root
    const bars = grabbers(root)
    expect(bars).toHaveLength(1)
    expect(bars[0]).toMatchObject({ backgroundColor: colors.composerBorder, borderRadius: 2.5 })
  })

  it('a one-rest bottom drawer draws no grabber, as the app’s full-only sheets do', async () => {
    const root = (await render(bottomDrawer(false))).root
    expect(grabbers(root)).toHaveLength(0)
    // The grabber's area (and its drag) stays, so the content does not jump up
    // under the corner; only the bar is not drawn.
    const [area] = root.findAll(
      (node) => String(node.type) === 'AnimatedView' && flatten(node.props.style).paddingVertical === 5.5
    )
    expect(area, 'the grabber area is gone').toBeDefined()
    const fills = area!.findAll((node) => String(node.type) === 'View').map((node) => flatten(node.props.style).backgroundColor)
    expect(fills.filter(Boolean)).toEqual([])
  })

  it.each(FAMILIES)('%s pads its grabber area 6 / 5.5 around the bar', async (_name, element) => {
    const root = (await render(element())).root
    const areas = root
      .findAll((node) => String(node.type) === 'AnimatedView')
      .map((node) => flatten(node.props.style))
      .filter((style) => style.paddingVertical === 5.5)
    expect(areas).toHaveLength(1)
    expect(areas[0]).toMatchObject({ paddingHorizontal: 6, alignItems: 'center' })
  })
})

// The open, its scrim, the hide and reduced motion, exactly as 0.9.139 played
// them (user's call, 2026-10-14). A spring-driven open, or a scrim on a spring
// of its own, fails these.
describe.each(FAMILIES)('%s moves as it did in 0.9.139', (_name, element, _testID, reduced) => {
  it('opens on the 180 ms timing, with no spring and no scrim motion of its own', async () => {
    await render(element())
    expect(mocks.timings).toContainEqual({ to: 1, duration: SHEET_SPEC.motion.openMs })
    expect(mocks.springs.filter((call) => call.to === 1)).toEqual([])
  })

  it('under reduced motion, does not travel and takes no spring', async () => {
    mocks.reduced = true
    await render(element())
    expect(mocks.springs.filter((call) => call.to === 1)).toEqual([])
    const opens = mocks.timings.filter((call) => call.to === 1)
    expect(opens).toEqual(reduced === 'fade' ? [{ to: 1, duration: SHEET_SPEC.motion.openMs }] : [])
  })

  it('hides on the 150 ms timing, the scrim going with it', async () => {
    const root = await render(element())
    mocks.springs.length = 0
    mocks.timings.length = 0
    await act(async () => {
      root.update(element(false))
    })
    expect(mocks.timings).toContainEqual({ to: 0, duration: SHEET_SPEC.motion.hideMs })
    expect(mocks.springs).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The ratchet. A source-reading test because the defect it guards is one of
// structure, not behaviour: a NEW sheet that styles itself (its own corner,
// its own ground, its own scrim) renders and passes every test of its own and
// still looks like a different app. It reads code, not comments.

const SRC = resolve(import.meta.dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === 'node_modules' || name === 'shared' ? [] : sourceFiles(path)
    }
    return /\.tsx?$/.test(name) && !/\.(test|generated)\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
  })
}

function parse(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
}

/** Every identifier and property name used in code (comments are not nodes). */
function namesIn(source: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      names.add(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return names
}

const TOP_CORNERS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderTopStartRadius', 'borderTopEndRadius']

/** Lines of object literals that round BOTH top corners (a sheet's silhouette;
 *  Left/Right or Start/End) with a value other than SHEET_SPEC.radius. */
function offSpecTopCorners(source: ts.SourceFile): number[] {
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const corners = node.properties.filter(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          TOP_CORNERS.includes(property.name.text)
      )
      if (corners.length >= 2 && corners.some((corner) => !corner.initializer.getText(source).includes('SHEET_SPEC.radius'))) {
        lines.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return lines
}

/** Every sheet in the app. A new one goes here, and must then read the spec. */
const SHEETS = [
  'components/mounted-bottom-drawer.tsx',
  'components/DraggableDetailSheet.tsx',
  'session/MobileNativeChatQueueEditor.tsx'
]
/** Rounded top corners that are not a sheet's, each with why. */
const NOT_SHEETS: Record<string, string> = {
  // The results list INSIDE the smart-source drawer, not a sheet of its own.
  'components/smart-workspace-source-drawer-styles.ts': 'inner list card'
}
/** `bgOverlay` users that are not a sheet's scrim. */
const OVERLAY_NOT_SHEETS = [
  'browser/mobile-browser-pane-styles.ts',
  'components/RightDrawer.tsx',
  'session/MobileNativeChatAttachmentChips.tsx'
]

describe('every sheet draws from the one spec (ratchet)', () => {
  const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }))

  it('lists real files, so an emptied list cannot pass', () => {
    for (const file of [...SHEETS, ...Object.keys(NOT_SHEETS), ...OVERLAY_NOT_SHEETS]) {
      expect(files.some((candidate) => candidate.path === file), file).toBe(true)
    }
  })

  // Corners are checked app-wide below; this is the colours.
  it('every sheet reads its colours from the spec', () => {
    const off = SHEETS.filter((file) => {
      const names = namesIn(parse(file, files.find((candidate) => candidate.path === file)!.text))
      return !names.has('sheetColors')
    })
    expect(off).toEqual([])
  })

  it('no surface rounds both top corners off the spec, unless it is listed as not a sheet', () => {
    const found = files
      .filter((file) => !(file.path in NOT_SHEETS))
      .flatMap((file) => offSpecTopCorners(parse(file.path, file.text)).map((line) => `${file.path}:${line}`))
    expect(found).toEqual([])
  })

  it('no new surface reaches for the old drawer scrim', () => {
    const found = files
      .filter((file) => !OVERLAY_NOT_SHEETS.includes(file.path) && namesIn(parse(file.path, file.text)).has('bgOverlay'))
      .map((file) => file.path)
    // tokens.ts declares it.
    expect(found).toEqual(['theme/tokens.ts'])
  })

  it('still catches the shape it was written for, and passes one that reads the spec', () => {
    const probe = parse(
      'probe.ts',
      '// borderTopLeftRadius: 1, borderTopRightRadius: 1\nconst a = { borderTopLeftRadius: 24, borderTopRightRadius: 24 }\nconst b = { borderTopLeftRadius: SHEET_SPEC.radius, borderTopRightRadius: SHEET_SPEC.radius }\nconst c = { borderTopStartRadius: 24, borderTopEndRadius: 24 }\nconst d = { borderTopLeftRadius: SHEET_SPEC.handle.width, borderTopRightRadius: SHEET_SPEC.handle.width }'
    )
    expect(offSpecTopCorners(probe)).toEqual([2, 4, 5])
  })
})
