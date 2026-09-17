import { createElement } from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, radius } from '../theme/tokens'

// The update dialog after UIAlertController (via BitChord's
// UpdateAvailableDialog.kt): a fixed 270 card with a 14 corner, stacked 44
// action rows under the message, a flat 28% black scrim that is "Later", and
// the release notes rendered as markdown inside a capped scroller. These tests
// were written against the previous Material-style card and watched fail:
// see the report for which ones went red on the unfixed code.

const mocks = vi.hoisted(() => {
  type Callback = ((result: { finished: boolean }) => void) | undefined
  const started: Callback[] = []
  const animation = () => ({
    start: (callback?: Callback) => {
      started.push(callback)
    },
    stop: vi.fn()
  })
  return {
    reducedMotion: false as boolean | 'reject' | 'never',
    started,
    spring: vi.fn(animation),
    timing: vi.fn(animation),
    layoutAnimation: vi.fn(),
    openUrl: vi.fn(() => Promise.resolve()),
    download: {
      resolve: (_uri: string) => undefined as void,
      reject: (_error: Error) => undefined as void,
      calls: 0
    }
  }
})

vi.mock('react-native', async () => {
  const React = await import('react')
  class AnimatedValue {
    value: number
    constructor(value: number) {
      this.value = value
    }
    interpolate(config: { inputRange: number[]; outputRange: number[] }) {
      return { interpolated: config }
    }
    setValue(value: number) {
      this.value = value
    }
  }
  const host =
    (tag: string) =>
    ({ children, ...props }: { children?: unknown }) =>
      React.createElement(tag, props, children)
  return {
    AccessibilityInfo: {
      addEventListener: vi.fn(() => ({ remove: vi.fn() })),
      isReduceMotionEnabled: vi.fn(() => {
        if (mocks.reducedMotion === 'reject') {
          return Promise.reject(new Error('no accessibility service'))
        }
        if (mocks.reducedMotion === 'never') {
          return new Promise<boolean>(() => {})
        }
        return Promise.resolve(mocks.reducedMotion)
      })
    },
    ActivityIndicator: 'ActivityIndicator',
    Animated: {
      Value: AnimatedValue,
      View: host('AnimatedView'),
      spring: mocks.spring,
      timing: mocks.timing,
      parallel: vi.fn((animations: { start: (cb?: unknown) => void }[]) => ({
        start: (callback?: unknown) => animations.forEach((a) => a.start(callback)),
        stop: vi.fn()
      }))
    },
    AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
    Easing: {
      back: () => (t: number) => t,
      ease: (t: number) => t,
      inOut: (e: unknown) => e,
      out: (e: unknown) => e,
      quad: (t: number) => t
    },
    LayoutAnimation: {
      configureNext: mocks.layoutAnimation,
      Presets: { easeInEaseOut: 'easeInEaseOut' }
    },
    Linking: { openURL: mocks.openUrl },
    Modal: 'Modal',
    Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 0.5 },
    Text: 'Text',
    View: 'View',
    useColorScheme: () => 'light'
  }
})

vi.mock('lucide-react-native', () => ({ ExternalLink: 'ExternalLink', X: 'X' }))
vi.mock('../components/OrcaLogo', () => ({ OrcaLogo: 'OrcaLogo' }))
vi.mock('../components/pr-sidebar/MermaidDiagram', () => ({ MermaidDiagram: 'MermaidDiagram' }))
vi.mock('./installed-version', () => ({
  getInstalledVersion: () => '0.6.4',
  getInstalledBuildNumber: () => '64'
}))
// The native updater is absent in vitest, which sends the store down the
// in-process download path; that path is what these tests drive.
vi.mock('@codeui/expo-apk-updater', () => ({
  isApkUpdaterAvailable: false,
  addApkUpdateProgressListener: vi.fn(),
  addApkUpdateStatusListener: vi.fn(),
  clearApkUpdateState: vi.fn(),
  getApkUpdateState: vi.fn(() => null),
  hasPendingInstallUserAction: vi.fn(() => false),
  installDownloadedApk: vi.fn(() => false),
  launchPendingInstallUserAction: vi.fn(),
  startApkUpdate: vi.fn()
}))
vi.mock('./android-apk-install', () => ({
  downloadApk: vi.fn(
    () =>
      new Promise<string>((resolve, reject) => {
        mocks.download.calls += 1
        mocks.download.resolve = resolve
        mocks.download.reject = reject
      })
  ),
  openApkInstaller: vi.fn(() => Promise.resolve())
}))

import { AppUpdateDialog } from './AppUpdateDialog'
import { useAppUpdateStore } from './app-update-store'
import { useApkInstallStore } from './apk-install-store'
import { resetAppUpdateDialogPresenterForTests } from './app-update-dialog-presenter'

/** The 0.6.4 release body exactly as GitHub's API returned it (CRLF and all). */
const RELEASE_0_6_4 = [
  "## What's changed",
  '',
  '- Release 0.6.4: messages stay where they happened',
  '- Draw a send where it happened, even when its boundary must stay withheld',
  '- Close the two untested gaps the echo audit named',
  '- Cover five echo functions nothing tested, and pin the cursor rule at the ceiling',
  '- Stop a long turn from evicting its own replies, and unbreak echo retirement',
  '- Word the desktop-image placeholder as the image chip already words it',
  '- Say when a desktop message carried an image, and never fail Submit silently',
  '- List background work straight through, with no per-kind headings',
  '',
  '**Full Changelog**: https://github.com/alwinpaul1/code-ui/compare/mobile-android-v0.6.3...mobile-android-v0.6.4',
  ''
].join('\r\n')

function showAvailable(releaseNotes: string | null = RELEASE_0_6_4) {
  useAppUpdateStore.setState({
    status: 'available',
    latestVersion: '0.6.5',
    latestBuildNumber: '65',
    releaseNotes,
    updateUrl: 'https://github.com/alwinpaul1/code-ui/releases/download/v0.6.5/code-ui.apk',
    releaseUrl: 'https://github.com/alwinpaul1/code-ui/releases/tag/mobile-android-v0.6.5',
    dismissedUpdateId: null,
    userInitiated: false
  })
}

let renderer: ReactTestRenderer | null = null

async function renderDialog(scheme: 'light' | 'dark' = 'light') {
  await act(async () => {
    renderer = create(
      createElement(ThemeProvider, { initialPreference: scheme }, createElement(AppUpdateDialog))
    )
  })
  return renderer!
}

function flattenStyle(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign({}, ...list.filter(Boolean))
}

function textOf(node: ReactTestInstance): string {
  return node
    .findAllByType('Text')
    .flatMap((text) => (Array.isArray(text.props.children) ? text.props.children : [text.props.children]))
    .filter((child) => typeof child === 'string')
    .join('')
}

function buttons(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll((node) => node.props.accessibilityRole === 'button')
}

function actionRow(root: ReactTestInstance, label: string): ReactTestInstance {
  const row = buttons(root).find((node) => node.props.accessibilityLabel === label)
  if (!row) {
    throw new Error(`no action row labelled ${label}`)
  }
  return row
}

function scrim(root: ReactTestInstance): ReactTestInstance {
  const node = root.findAll(
    (candidate) => candidate.type === 'Pressable' && candidate.props.accessibilityLabel === 'Dismiss'
  )[0]
  if (!node) {
    throw new Error('no dismissable scrim')
  }
  return node
}

function card(root: ReactTestInstance): ReactTestInstance {
  const node = root.findAll((candidate) => candidate.props.accessibilityViewIsModal === true)[0]
  if (!node) {
    throw new Error('no card')
  }
  return node
}

/** The press that dismissed the dialog finishes one frame later (see
 *  app-update-dismiss-defer.ts), and the close then starts the touch
 *  shield's tail; two rounds of pending timers cover both. */
async function settle() {
  await act(async () => {
    vi.runOnlyPendingTimers()
  })
  await act(async () => {
    vi.runOnlyPendingTimers()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  resetAppUpdateDialogPresenterForTests()
  useAppUpdateStore.setState({
    status: 'idle',
    latestVersion: null,
    latestBuildNumber: null,
    releaseNotes: null,
    updateUrl: null,
    releaseUrl: null,
    dismissedUpdateId: null,
    userInitiated: false
  })
  useApkInstallStore.setState({ phase: 'idle', progress: 0, version: null, fileUri: null, error: null })
  mocks.reducedMotion = false
  mocks.started.length = 0
  mocks.download.calls = 0
  mocks.spring.mockClear()
  mocks.timing.mockClear()
  mocks.layoutAnimation.mockClear()
})

afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
})

describe('the card is an alert, not a sheet', () => {
  it('is 270 wide with a 14 corner, whatever the screen width', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    const style = flattenStyle(card(root).props.style)
    expect(style.width).toBe(270)
    expect(style.borderRadius).toBe(radius.md)
    expect(style.borderRadius).toBe(14)
    expect(style.maxWidth).toBeUndefined()
  })

  it('sits on a flat 28% black scrim, the same in light and dark', async () => {
    showAvailable()
    for (const scheme of ['light', 'dark'] as const) {
      await act(async () => renderer?.unmount())
      resetAppUpdateDialogPresenterForTests()
      const root = (await renderDialog(scheme)).root
      const dim = root.findAll(
        (node) => flattenStyle(node.props.style).backgroundColor === 'rgba(0, 0, 0, 0.28)'
      )
      expect(dim.length, `${scheme}: one scrim view`).toBeGreaterThanOrEqual(1)
    }
  })

  it('draws a frosted material that follows the appearance setting', async () => {
    showAvailable()
    expect(flattenStyle(card((await renderDialog('light')).root).props.style).backgroundColor).toBe(
      lightColors.alertMaterial
    )
    await act(async () => renderer?.unmount())
    resetAppUpdateDialogPresenterForTests()
    expect(flattenStyle(card((await renderDialog('dark')).root).props.style).backgroundColor).toBe(
      darkColors.alertMaterial
    )
  })

  it('stacks full-width 44 rows under the message, separated by hairlines', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    const update = actionRow(root, 'Update now')
    const later = actionRow(root, 'Later')
    for (const row of [update, later]) {
      const style = flattenStyle(
        typeof row.props.style === 'function' ? row.props.style({ pressed: false }) : row.props.style
      )
      expect(style.minHeight).toBe(44)
      expect(style.alignSelf).toBe('stretch')
      expect(style.borderTopWidth).toBe(0.5)
    }
  })

  it('highlights a row the instant it is pressed, and clears it when the finger drags away', async () => {
    showAvailable()
    const row = actionRow((await renderDialog()).root, 'Update now')
    // A style FUNCTION is the only way a Pressable paints on press-in rather
    // than on release; a static style is release-only feedback.
    expect(typeof row.props.style).toBe('function')
    expect(flattenStyle(row.props.style({ pressed: true })).backgroundColor).toBe(
      lightColors.alertRowPressed
    )
    expect(flattenStyle(row.props.style({ pressed: false })).backgroundColor).toBe('transparent')
  })
})

describe('tapping the dim behind the card', () => {
  it('is Later while an update is offered', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    await act(async () => scrim(root).props.onPress())
    await settle()
    expect(useAppUpdateStore.getState().status).toBe('up-to-date')
    expect(useAppUpdateStore.getState().dismissedUpdateId).not.toBeNull()
  })

  it('does nothing while the update is installing', async () => {
    useApkInstallStore.setState({ phase: 'installing', version: '0.6.5' })
    const root = (await renderDialog()).root
    expect(
      root.findAll((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Dismiss')
    ).toHaveLength(0)
    expect(useApkInstallStore.getState().phase).toBe('installing')
  })

  it('leaves a running download running when the sheet goes away', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    await act(async () => actionRow(root, 'Update now').props.onPress())
    expect(mocks.download.calls).toBe(1)
    expect(useApkInstallStore.getState().phase).toBe('downloading')
    // The download sends the dialog away by itself (2026-09-14): nothing is
    // left to tap, and nothing that leaves must touch the transfer.
    await settle()
    expect(root.findAllByType('Modal')).toHaveLength(0)
    expect(useApkInstallStore.getState().phase).toBe('downloading')
    await act(async () => {
      mocks.download.resolve('file:///cache/updates/code-ui-0.6.5.apk')
    })
    expect(useApkInstallStore.getState().phase).toBe('ready')
    expect(textOf(root)).toContain('Update downloaded')
  })
})

describe('release notes', () => {
  it('render as markdown: the section heading in weight, the changes as a bulleted list', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    const copy = textOf(root)
    expect(copy).toContain("What's changed")
    expect(copy).toContain('Draw a send where it happened')
    const bullets = root.findAll(
      (node) => node.type === 'Text' && node.props.children === '•'
    )
    expect(bullets).toHaveLength(8)
    // The section label is a heading by weight, not a 22px display line the
    // 270 card has no room for.
    const label = root.findAll(
      (node) =>
        node.type === 'Text' &&
        flattenStyle(node.props.style).fontFamily === 'InstrumentSans_600SemiBold' &&
        textOf(node) === "What's changed"
    )
    expect(label.length).toBeGreaterThanOrEqual(1)
  })

  it('scroll inside the card past 220 instead of growing it', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    const scroller = root.findAll(
      (node) => node.type === 'ScrollView' && flattenStyle(node.props.style).maxHeight === 220
    )[0]
    expect(scroller).toBeTruthy()
    expect(scroller!.props.persistentScrollbar).toBe(true)
    expect(textOf(scroller!)).toContain('List background work straight through')
  })

  it('do not leave a large empty card under one short line', async () => {
    showAvailable('- Fix the thing')
    const root = (await renderDialog()).root
    const scroller = root.findAll((node) => node.type === 'ScrollView')[0]!
    const style = flattenStyle(scroller.props.style)
    expect(style.maxHeight).toBe(220)
    expect(style.height).toBeUndefined()
    expect(style.minHeight).toBeUndefined()
    expect(root.findAll((node) => node.type === 'Text' && node.props.children === '•')).toHaveLength(1)
  })

  it('fall back to one line when the release carries none', async () => {
    showAvailable(null)
    const root = (await renderDialog()).root
    expect(textOf(root)).toContain('Fixes and improvements.')
    expect(root.findAll((node) => node.type === 'Text' && node.props.children === '•')).toHaveLength(0)
  })

  it('keep the full changelog reachable as a short link, not a bare URL', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    expect(textOf(root)).toContain('Full changelog')
    expect(textOf(root)).not.toContain('compare/mobile-android-v0.6.3')
  })

  it('do not throw on a body with an image in it', async () => {
    showAvailable('## What\'s new\n\n![shot](https://github.com/user-attachments/assets/abc.png)\n\n- One fix')
    const root = (await renderDialog()).root
    expect(textOf(root)).toContain('One fix')
  })
})

describe('motion', () => {
  it('materialises on a critically damped spring, scale and opacity together', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    expect(mocks.spring).toHaveBeenCalled()
    expect(mocks.timing).not.toHaveBeenCalled()
    const config = mocks.spring.mock.calls[0]![1] as Record<string, unknown>
    expect(config.useNativeDriver).toBe(true)
    expect(config.toValue).toBe(1)
    // Apple's default UI spring: damping ratio 1, response 0.35 s.
    expect(config.damping).toBeCloseTo(2 * Math.sqrt(config.stiffness as number), 6)
    const style = flattenStyle(card(root).props.style)
    const scale = (style.transform as { scale: { interpolated: { outputRange: number[] } } }[])[0]!
    expect(scale.scale.interpolated.outputRange).toEqual([1.1, 1])
  })

  it('cross-fades under reduced motion, with no scale and no overshoot', async () => {
    mocks.reducedMotion = true
    showAvailable()
    const root = (await renderDialog()).root
    expect(mocks.spring).not.toHaveBeenCalled()
    expect(mocks.timing).toHaveBeenCalled()
    const config = mocks.timing.mock.calls[0]![1] as Record<string, unknown>
    expect(config.duration).toBe(160)
    expect(config.useNativeDriver).toBe(true)
    const style = flattenStyle(card(root).props.style)
    const scale = (style.transform as { scale: { interpolated: { outputRange: number[] } } }[])[0]!
    expect(scale.scale.interpolated.outputRange).toEqual([1, 1])
  })

  it('still appears when the OS never answers about reduced motion', async () => {
    mocks.reducedMotion = 'reject'
    showAvailable()
    await renderDialog()
    expect(mocks.spring).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    expect(mocks.spring).toHaveBeenCalled()
  })

  // No exit path, on purpose. Recorded on a Galaxy S23 running 0.3.2: a card
  // fading out over the About list read as a press on the row beneath it. The
  // card goes the frame the dialog closes; only the touch shield outlives it.
  it('is gone the instant the dialog closes, while the shield still stands', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    await act(async () => scrim(root).props.onPress())
    await act(async () => {
      // Only the deferred close, not the shield's tail.
      vi.advanceTimersByTime(1)
    })
    expect(useAppUpdateStore.getState().status).toBe('up-to-date')
    expect(root.findAll((node) => node.props.accessibilityViewIsModal === true)).toHaveLength(0)
    // The entry spring ran; no spring ever ran towards 0. (An `every` over
    // the calls alone is true of an empty list, which a reviewer caught.)
    expect(mocks.spring).toHaveBeenCalled()
    expect(
      mocks.spring.mock.calls.filter(([, config]) => (config as { toValue: number }).toValue === 0)
    ).toHaveLength(0)
    // The window stays for the tail, as a 1% fill nothing can press through.
    expect(root.findAllByType('Modal')).toHaveLength(1)
    await settle()
    expect(root.findAllByType('Modal')).toHaveLength(0)
  })

  it('never animates the window-filling scrim, so a held press cannot fall through it', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    const fill = root.findAll(
      (node) =>
        node.type === 'Pressable' &&
        flattenStyle(node.props.style).backgroundColor === 'rgba(0, 0, 0, 0.28)'
    )
    expect(fill).toHaveLength(1)
    expect(flattenStyle(fill[0]!.props.style).opacity).toBeUndefined()
  })
})

// The height morph between states is what `morphKey` and the render-phase
// LayoutAnimation exist for, and nothing asserted it (review, 2026-09-17).
describe('the card changing state', () => {
  it('eases its height to the new content instead of snapping', async () => {
    showAvailable()
    await renderDialog()
    expect(mocks.layoutAnimation).not.toHaveBeenCalled()
    await act(async () => {
      useApkInstallStore.setState({ phase: 'ready', version: '0.6.5' })
    })
    expect(mocks.layoutAnimation).toHaveBeenCalledWith('easeInEaseOut')
  })

  it('snaps under reduced motion', async () => {
    mocks.reducedMotion = true
    showAvailable()
    await renderDialog()
    await act(async () => {
      useApkInstallStore.setState({ phase: 'ready', version: '0.6.5' })
    })
    expect(mocks.layoutAnimation).not.toHaveBeenCalled()
  })

  // While the OS has not yet said, the card is held at reveal 0 rather than
  // sprung; the morph must be held the same way, or a reduced-motion user
  // gets a height animation in that window (review, 2026-09-17).
  it('does not morph while the motion preference is still unknown', async () => {
    mocks.reducedMotion = 'never'
    showAvailable()
    await renderDialog()
    await act(async () => {
      useApkInstallStore.setState({ phase: 'ready', version: '0.6.5' })
    })
    expect(mocks.layoutAnimation).not.toHaveBeenCalled()
  })
})

// Every state of the machine, rendered: what it says, which rows it has,
// and whether the scrim is a way out. Four of the eight were never rendered
// by the first version of this file (review, 2026-09-17).
describe('each state of the alert', () => {
  type Case = {
    kind: string
    arrange: () => void
    title: string
    rows: string[]
    scrimDismisses: boolean
  }
  const cases: Case[] = [
    {
      kind: 'checking',
      arrange: () => useAppUpdateStore.setState({ status: 'checking', userInitiated: true }),
      title: 'Checking for updates',
      rows: [],
      scrimDismisses: false
    },
    // The copy of these two is what About → "Check for updates" shows, the
    // path most people take; it is pinned to what shipped, not restyled.
    {
      kind: 'up-to-date',
      arrange: () => useAppUpdateStore.setState({ status: 'up-to-date', userInitiated: true }),
      title: "You're up to date",
      rows: ['Done'],
      scrimDismisses: true
    },
    {
      kind: 'check-failed',
      arrange: () => useAppUpdateStore.setState({ status: 'error', userInitiated: true }),
      title: 'Could not check for updates',
      rows: ['OK'],
      scrimDismisses: true
    },
    {
      kind: 'available',
      arrange: () => showAvailable(),
      title: 'Update available',
      rows: ['Update now', 'View on GitHub', 'Later'],
      scrimDismisses: true
    },
    {
      kind: 'installing',
      arrange: () => {
        showAvailable()
        useApkInstallStore.setState({ phase: 'installing', version: '0.6.5' })
      },
      title: 'Installing',
      rows: [],
      scrimDismisses: false
    },
    {
      kind: 'ready',
      arrange: () => {
        showAvailable()
        useApkInstallStore.setState({ phase: 'ready', version: '0.6.5' })
      },
      title: 'Update downloaded',
      rows: ['Install', 'Later'],
      // Later here deletes the downloaded APK; a stray tap must not.
      scrimDismisses: false
    },
    {
      kind: 'failed',
      arrange: () => {
        showAvailable()
        useApkInstallStore.setState({ phase: 'failed', version: '0.6.5', error: 'No space left' })
      },
      title: 'Update failed',
      rows: ['Try again', 'Not now'],
      scrimDismisses: true
    },
    {
      kind: 'failed with nothing to retry',
      arrange: () => {
        showAvailable()
        useAppUpdateStore.setState({ updateUrl: null })
        useApkInstallStore.setState({ phase: 'failed', version: '0.6.5', error: 'No space left' })
      },
      title: 'Update failed',
      rows: ['Not now'],
      scrimDismisses: true
    }
  ]

  it.each(cases)('$kind: says "$title", offers $rows, scrim dismisses: $scrimDismisses', async (c) => {
    c.arrange()
    const root = (await renderDialog()).root
    expect(root.findAllByType('Modal')).toHaveLength(1)
    expect(textOf(root)).toContain(c.title)
    const labels = buttons(root)
      .filter((node) => node.props.accessibilityLabel !== 'Dismiss')
      .map((node) => node.props.accessibilityLabel)
    expect(labels).toEqual(c.rows)
    const dismissers = root.findAll(
      (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Dismiss'
    )
    expect(dismissers).toHaveLength(c.scrimDismisses ? 1 : 0)
  })

  // Hardware back is the scrim's twin: it closes the same states and leaves
  // the same ones alone. Nothing recorded that before (review, 2026-09-17).
  it.each(cases)('$kind: hardware back closes it: $scrimDismisses', async (c) => {
    c.arrange()
    const root = (await renderDialog()).root
    const snapshot = () => ({
      update: useAppUpdateStore.getState().status,
      userInitiated: useAppUpdateStore.getState().userInitiated,
      install: useApkInstallStore.getState().phase
    })
    const before = snapshot()
    await act(async () => root.findByType('Modal').props.onRequestClose())
    await settle()
    const after = snapshot()
    if (!c.scrimDismisses) {
      expect(after).toEqual(before)
      expect(root.findAllByType('Modal')).toHaveLength(1)
      return
    }
    expect(after).not.toEqual(before)
    if (c.kind.startsWith('failed')) {
      // Not now on a failed download clears the failure and the card falls
      // back to the offer it came from, as it did before the rebuild.
      expect(root.findAllByType('Modal')).toHaveLength(1)
      expect(textOf(root)).toContain('Update available')
    } else {
      expect(root.findAllByType('Modal')).toHaveLength(0)
    }
  })

  it('failed: shows the error the store recorded', async () => {
    showAvailable()
    useApkInstallStore.setState({ phase: 'failed', version: '0.6.5', error: 'No space left' })
    expect(textOf((await renderDialog()).root)).toContain('No space left')
  })

  it('hidden: shows no window at all', async () => {
    const root = (await renderDialog()).root
    expect(root.findAllByType('Modal')).toHaveLength(0)
  })

  it('hidden: a download in flight shows no window either', async () => {
    showAvailable()
    useApkInstallStore.setState({ phase: 'downloading', version: '0.6.5', progress: 0.4 })
    const root = (await renderDialog()).root
    expect(root.findAllByType('Modal')).toHaveLength(0)
  })
})

// The card went from `maxWidth: 380` to a fixed 270 and sits in a wrapper
// that does not scroll, so a long error or a large font size could push the
// rows off the bottom of a small screen (review, 2026-09-17). The card is
// bounded by the screen, the text region gives way, the rows never do.
describe('a card taller than the screen', () => {
  it('is bounded by the wrapper, so its rows stay reachable', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    expect(flattenStyle(card(root).props.style).maxHeight).toBe('100%')
  })

  it('lets the notes give way before the rows do', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    const notes = root.findAll(
      (node) => node.type === 'ScrollView' && flattenStyle(node.props.style).maxHeight === 220
    )[0]!
    expect(flattenStyle(notes.props.style).flexShrink).toBe(1)
    for (const label of ['Update now', 'View on GitHub', 'Later']) {
      const row = actionRow(root, label)
      expect(flattenStyle(row.props.style({ pressed: false })).flexShrink).toBe(0)
    }
  })

  it('scrolls a long failure message inside the card rather than growing past the screen', async () => {
    showAvailable()
    const error = 'Download failed: ' + 'the server closed the connection before the file was complete. '.repeat(12)
    useApkInstallStore.setState({ phase: 'failed', version: '0.6.5', error })
    const root = (await renderDialog()).root
    const scroller = root.findAll(
      (node) => node.type === 'ScrollView' && flattenStyle(node.props.style).maxHeight === 220
    )[0]
    expect(scroller).toBeTruthy()
    expect(textOf(scroller!)).toContain('the server closed the connection')
    expect(actionRow(root, 'Not now')).toBeTruthy()
  })

  it('lets a row grow with the font size instead of clipping its label', async () => {
    showAvailable()
    const row = actionRow((await renderDialog()).root, 'Later')
    const style = flattenStyle(row.props.style({ pressed: false }))
    expect(style.minHeight).toBe(44)
    expect(style.height).toBeUndefined()
    expect(row.findByType('Text').props.numberOfLines).toBeUndefined()
  })
})

describe('the release page', () => {
  it('is one row away, and the alert stays while it opens', async () => {
    showAvailable()
    const root = (await renderDialog()).root
    await act(async () => actionRow(root, 'View on GitHub').props.onPress())
    expect(mocks.openUrl).toHaveBeenCalledWith(
      'https://github.com/alwinpaul1/code-ui/releases/tag/mobile-android-v0.6.5'
    )
    expect(root.findAllByType('Modal')).toHaveLength(1)
    expect(useAppUpdateStore.getState().status).toBe('available')
  })
})
