import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Every bottom sheet that can open while the chat composer's keyboard is up,
// and has nothing to type, asks its drawer to send the keyboard away as it
// opens (bottom-drawer-dismisses-keyboard-on-open.test.tsx has why: a sheet
// otherwise stands at rest under the keyboard until its window takes focus).
// The + sheet does it itself, on touch-down (MobileNativeChatAttachButton),
// and so does the model picker's pill (openPicker).
//
// How each opens over the keyboard:
//   context window  the composer's ring
//   permission / agent mode  the + sheet's Permission row (keyboard already gone)
//   background tasks  the "N running tasks" row above the composer
//   agent run  an agent row in the transcript
//   dictation setup  the mic, before speech is set up
//   ConfirmModal  rewind on a sent message; leaving with drafts
//   ActionSheetModal  the header's ⋯, the tab strip's + and a tab's long press

const drawerProps = vi.hoisted(() => [] as Record<string, unknown>[])

vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: (props: Record<string, unknown>) => {
    drawerProps.push(props)
    return null
  }
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    Image: 'Image',
    Keyboard: { dismiss: () => {}, addListener: () => ({ remove: () => {} }) },
    Linking: { openURL: async () => {} },
    Platform: { OS: 'android', select: (options: { android?: unknown }) => options.android },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('ScrollView', props, children),
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFill: {}, hairlineWidth: 1, flatten: (s: unknown) => s },
    Text: 'Text',
    View: 'View',
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 412, height: 956, scale: 3, fontScale: 1 })
  }
})

vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})

import { ThemeProvider } from '../theme/theme-context'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { ConfirmModal } from '../components/ConfirmModal'
import { MobileDictationSetupSheet } from '../components/MobileDictationSetupSheet'
import { MobileAgentModeSheet } from './MobileAgentModeSheet'
import { MobileBackgroundTasksSheet } from './MobileBackgroundTasksSheet'
import { MobileContextWindowSheet } from './MobileContextWindowSheet'
import { MobileNativeChatAgentRunSheet } from './MobileNativeChatAgentRunSheet'
import { MobilePermissionModeSheet } from './MobilePermissionModeSheet'

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  drawerProps.length = 0
})

const noop = (): void => {}

const SHEETS: [string, () => ReactElement][] = [
  [
    'the context window sheet',
    () =>
      createElement(MobileContextWindowSheet, {
        visible: true,
        context: { usedPercent: 42 } as never,
        onClose: noop
      })
  ],
  [
    'the permission mode sheet',
    () => createElement(MobilePermissionModeSheet, { visible: true, current: 'default', onSelect: noop, onClose: noop })
  ],
  [
    'the agent mode sheet',
    () => createElement(MobileAgentModeSheet, { visible: true, current: 'default' as never, onSelect: noop, onClose: noop })
  ],
  [
    'the background tasks sheet',
    () =>
      createElement(MobileBackgroundTasksSheet, {
        visible: true,
        messages: [],
        agent: 'claude',
        onClose: noop
      } as never)
  ],
  [
    'the agent run sheet',
    () => createElement(MobileNativeChatAgentRunSheet, { visible: true, entries: [], running: false, onClose: noop } as never)
  ],
  [
    'the dictation setup sheet',
    () => createElement(MobileDictationSetupSheet, { visible: true, client: null, onClose: noop, onReady: noop })
  ],
  [
    'a confirmation (rewind, leave with drafts)',
    () =>
      createElement(ConfirmModal, {
        visible: true,
        title: 'Rewind to here?',
        message: 'Later messages are removed.',
        onConfirm: noop,
        onCancel: noop
      })
  ],
  [
    'an action sheet (header ⋯, new tab, tab actions)',
    () => createElement(ActionSheetModal, { visible: true, title: 'New Tab', actions: [], onClose: noop })
  ]
]

describe.each(['light', 'dark'] as const)('sheets that open over the chat keyboard, in %s mode', (scheme) => {
  it.each(SHEETS)('%s sends the keyboard away as it opens', async (_name, element) => {
    await act(async () => {
      renderer = create(<ThemeProvider initialPreference={scheme}>{element()}</ThemeProvider>)
    })
    expect(drawerProps.length, 'the sheet did not render its drawer').toBeGreaterThan(0)
    expect(drawerProps.at(-1)!.dismissKeyboardOnOpen).toBe(true)
  })
})

/** The file's code with its comments taken out, so a "why" that names the
 *  prop cannot stand in for the prop itself. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return sourceFiles(full)
    }
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [full] : []
  })
}

describe('sheets that bring their own keyboard', () => {
  const src = path.resolve(import.meta.dirname, '..')
  const drawers = sourceFiles(src).filter((file) => /<BottomDrawer\b/.test(codeOf(file)))
  const typing = drawers.filter((file) => /\bautoFocus\b/.test(codeOf(file)))

  // The chat's queue editor also focuses a field as it opens, but it is a
  // plain Modal with its own KeyboardAvoidingView, not a bottom drawer.
  it('are found (TextInputModal, the smart-source and diff-comment drawers)', () => {
    const names = typing.map((file) => path.basename(file))
    for (const expected of [
      'TextInputModal.tsx',
      'SmartWorkspaceSourceDrawer.tsx',
      'MobileDiffReviewDrawers.tsx'
    ]) {
      expect(names).toContain(expected)
    }
  })

  it.each(typing.map((file) => [path.relative(src, file)]))('%s does not ask its drawer to dismiss the keyboard', (file) => {
    // The dismissal runs after the sheet's children mount, so it would blur
    // the field the sheet just focused.
    expect(codeOf(path.join(src, file))).not.toMatch(/\bdismissKeyboardOnOpen\b/)
  })
})
