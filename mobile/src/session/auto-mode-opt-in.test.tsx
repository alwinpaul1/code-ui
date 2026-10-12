import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Claude Android app's Auto mode opt-in (1.261009.20): the first pick of
// Auto asks "Enable Auto mode?" with Learn more, Not now and Enable; Enable
// remembers the yes on the device and then applies Auto. Claude Code 2.1.296
// asks nothing itself (its `--enable-auto-mode` opt-in is "(deprecated)"), so
// this question is the phone's alone and must never cost the user a pick.

const store = vi.hoisted(() => ({
  held: new Map<string, string>(),
  readsFail: false,
  writesFail: false
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      if (store.readsFail) {
        throw new Error('the store would not open')
      }
      return store.held.get(key) ?? null
    },
    setItem: async (key: string, value: string) => {
      if (store.writesFail) {
        throw new Error('the store would not take it')
      }
      store.held.set(key, value)
    }
  }
}))

type Action = { label: string; onPress: () => void }
const sheets = vi.hoisted(() => ({
  modeActions: [] as Action[],
  modeVisible: false,
  drawers: [] as { visible: boolean; children: unknown }[]
}))
vi.mock('../components/ActionSheetModal', () => ({
  ActionSheetModal: (props: { visible: boolean; actions: Action[] }) => {
    sheets.modeVisible = props.visible
    sheets.modeActions = props.actions
    return null
  }
}))
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: (props: { visible: boolean; children: React.ReactNode }) =>
      props.visible ? React.createElement('Drawer', null, props.children) : null
  }
})
const linking = vi.hoisted(() => ({ opened: [] as string[] }))
vi.mock('react-native', () => ({
  Linking: {
    openURL: async (url: string) => {
      linking.opened.push(url)
    }
  },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  ActivityIndicator: 'ActivityIndicator',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true })
)
vi.mock('./MobileContextWindowSheet', () => ({ MobileContextWindowSheet: () => null }))
vi.mock('./MobileAgentModeSheet', () => ({ MobileAgentModeSheet: () => null }))

import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatComposerSheets } from './MobileNativeChatComposerSheets'
import type { TerminalPermissionMode } from './mobile-terminal-hud-parse'

let renderer: ReactTestRenderer | null = null
let picked: TerminalPermissionMode[] = []

beforeEach(() => {
  store.held.clear()
  store.readsFail = false
  store.writesFail = false
  picked = []
  linking.opened = []
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

async function mount(permissionMode: TerminalPermissionMode | null = 'manual') {
  await act(async () => {
    renderer = create(
      createElement(
        ThemeProvider,
        null,
        createElement(MobileNativeChatComposerSheets, {
          showModeSheet: true,
          onCloseModeSheet: () => {},
          permissionMode,
          onSelectPermissionMode: (mode: TerminalPermissionMode) => picked.push(mode),
          showContextSheet: false,
          onCloseContextSheet: () => {},
          contextWindow: null
        })
      )
    )
  })
}

async function pick(label: string) {
  await act(async () => sheets.modeActions.find((a) => a.label === label)!.onPress())
}

function optInTexts(): string[] {
  return renderer!.root
    .findAll((node) => (node.type as unknown) === 'Text' && typeof node.props.children === 'string')
    .map((node) => node.props.children as string)
}

function button(label: string) {
  return renderer!.root.find(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function'
  )
}

describe('the first pick of Auto asks before it switches', () => {
  it('asks "Enable Auto mode?" and leaves the terminal alone until Enable', async () => {
    await mount()
    await pick('Auto')
    expect(optInTexts()).toContain('Enable Auto mode?')
    expect(optInTexts()).toContain('Learn more')
    expect(picked).toEqual([])
    await act(async () => button('Enable').props.onPress())
    expect(picked).toEqual(['auto'])
    expect(store.held.get('orca:autoModeOptedIn')).toBe('true')
    expect(optInTexts()).not.toContain('Enable Auto mode?')
  })

  it('does nothing on Not now, and asks again next time', async () => {
    await mount()
    await pick('Auto')
    await act(async () => button('Not now').props.onPress())
    expect(picked).toEqual([])
    expect(optInTexts()).not.toContain('Enable Auto mode?')
    await pick('Auto')
    expect(optInTexts()).toContain('Enable Auto mode?')
  })

  it('opens the docs from Learn more', async () => {
    await mount()
    await pick('Auto')
    const link = renderer!.root.find((node) => node.props.children === 'Learn more' && node.props.onPress)
    await act(async () => link.props.onPress())
    expect(linking.opened).toEqual(['https://code.claude.com/docs/en/security'])
  })

  it('goes straight to Auto once the phone has said yes', async () => {
    store.held.set('orca:autoModeOptedIn', 'true')
    await mount()
    await pick('Auto')
    expect(picked).toEqual(['auto'])
    expect(optInTexts()).not.toContain('Enable Auto mode?')
  })

  it('never asks for another mode, or for Auto on a session already in it', async () => {
    await mount()
    await pick('Plan')
    expect(picked).toEqual(['plan'])
    act(() => renderer?.unmount())
    await mount('auto')
    await pick('Auto')
    expect(picked).toEqual(['plan', 'auto'])
    expect(optInTexts()).not.toContain('Enable Auto mode?')
  })

  it('asks when the store cannot be read, and still switches when the yes cannot be saved', async () => {
    store.held.set('orca:autoModeOptedIn', 'true')
    store.readsFail = true
    store.writesFail = true
    await mount()
    await pick('Auto')
    expect(optInTexts()).toContain('Enable Auto mode?')
    await act(async () => button('Enable').props.onPress())
    expect(picked).toEqual(['auto'])
  })
})
