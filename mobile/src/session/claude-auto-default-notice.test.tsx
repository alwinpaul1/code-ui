import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'

// The Claude app's one-time notice (1.261013.20 jv30.java:75, strings ccr_auto_default_notice_*,
// "Got it" h5n.java:194): the first time a session is in Auto mode because Auto is now the
// default, it says so once per install and remembers the dismissal on the device
// (`auto_default_notice_seen`, mr8.java:45). Code UI shows it on a Claude tab matched to its
// Anthropic session whose mode is Auto, and writes nothing to the desktop.

const store = vi.hoisted(() => ({ held: new Map<string, string>(), readFails: false, writeFails: false, reads: 0 }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => {
      store.reads += 1
      if (store.readFails) {
        throw new Error('storage unavailable')
      }
      return store.held.get(key) ?? null
    },
    setItem: async (key: string, value: string) => {
      if (store.writeFails) {
        throw new Error('disk full')
      }
      store.held.set(key, value)
    }
  }
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: (props: { visible: boolean; children: unknown }) => (props.visible ? createElement('Drawer', null, props.children as never) : null)
}))

import { ThemeProvider } from '../theme/theme-context'
import {
  AUTO_DEFAULT_NOTICE_BODY,
  AUTO_DEFAULT_NOTICE_TITLE,
  MobileClaudeAutoDefaultNotice,
  claudeAutoDefaultNoticeEligible,
  resetAutoDefaultNoticeForTests
} from './MobileClaudeAutoDefaultNotice'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const KEY = 'orca:autoDefaultNoticeSeen'
let renderer: ReactTestRenderer | null = null

function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}
const drawer = (): ReactTestInstance | undefined => renderer!.root.findAll((node) => (node.type as unknown) === 'Drawer')[0]
const words = (node: ReactTestInstance): string[] =>
  node.findAll((child) => (child.type as unknown) === 'Text').map((child) => [child.props.children].flat().join(''))
const gotIt = (): ReactTestInstance => renderer!.root.find((node) => node.props.accessibilityLabel === 'Got it' && typeof node.props.onPress === 'function')

async function mount(over: { scheme?: 'light' | 'dark'; eligible?: boolean } = {}): Promise<void> {
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={over.scheme ?? 'light'}>
        <MobileClaudeAutoDefaultNotice eligible={over.eligible ?? true} />
      </ThemeProvider>
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}
async function remount(over: { eligible?: boolean } = {}): Promise<void> {
  act(() => renderer?.unmount())
  await mount(over)
}

beforeEach(() => {
  store.held.clear()
  store.readFails = false
  store.writeFails = false
  store.reads = 0
  resetAutoDefaultNoticeForTests()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe.each(['light', 'dark'] as const)('the Auto-default notice in %s mode', (scheme) => {
  const colors = scheme === 'light' ? lightColors : darkColors

  it('says the app’s title and body, with "Got it", on the theme’s text colours', async () => {
    await mount({ scheme })
    const sheet = drawer()!
    expect(words(sheet)).toEqual(expect.arrayContaining([AUTO_DEFAULT_NOTICE_TITLE, AUTO_DEFAULT_NOTICE_BODY]))
    expect(AUTO_DEFAULT_NOTICE_TITLE).toBe('Auto mode is now Claude Code’s default permission mode')
    expect(AUTO_DEFAULT_NOTICE_BODY).toBe(
      'Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for risky actions and prompt injection before executing, runs the ones it assesses as lower-risk, and blocks the rest.'
    )
    const title = sheet.find((node) => (node.type as unknown) === 'Text' && node.props.children === AUTO_DEFAULT_NOTICE_TITLE)
    expect(flat(title.props.style).color).toBe(colors.text)
    expect(gotIt()).toBeDefined()
  })
})

describe('once per install', () => {
  it('Got it closes it and stores the dismissal, so it never shows again', async () => {
    await mount()
    await act(async () => {
      gotIt().props.onPress()
      await Promise.resolve()
    })
    expect(drawer()).toBeUndefined()
    expect(store.held.get(KEY)).toBe('true')
    resetAutoDefaultNoticeForTests()
    await remount()
    expect(drawer()).toBeUndefined()
  })

  it('a dismissal stored before this launch keeps it closed', async () => {
    store.held.set(KEY, 'true')
    await mount()
    expect(drawer()).toBeUndefined()
  })

  it('shows on no tab but a matched Claude tab in Auto mode, and reads nothing for one', async () => {
    await mount({ eligible: false })
    expect(drawer()).toBeUndefined()
    expect(store.reads).toBe(0)
  })

  it('reads the store once per launch, not once per tab', async () => {
    await mount()
    await remount()
    expect(store.reads).toBe(1)
  })
})

describe('when the store fails', () => {
  it('a store that cannot be read shows nothing: a notice is never worth nagging over', async () => {
    store.readFails = true
    await mount()
    expect(drawer()).toBeUndefined()
  })

  it('a dismissal that cannot be written still closes it for this launch', async () => {
    store.writeFails = true
    await mount()
    await act(async () => {
      gotIt().props.onPress()
      await Promise.resolve()
    })
    expect(drawer()).toBeUndefined()
    await remount()
    expect(drawer()).toBeUndefined()
  })
})

describe('which tab it shows on', () => {
  const tab = (over: { shown?: boolean; gate?: string; mode?: string | null }) => ({
    showNativeChat: over.shown ?? true,
    nativeChatAnthropicGate: { kind: over.gate ?? 'matched' },
    nativeChatPermissionMode: over.mode === undefined ? 'auto' : over.mode
  }) as never

  it('a Claude chat matched to its Anthropic session, in Auto mode', () => {
    expect(claudeAutoDefaultNoticeEligible(tab({}))).toBe(true)
  })

  it('not in another mode, not before the match (and so never on Codex), not under the terminal', () => {
    expect(claudeAutoDefaultNoticeEligible(tab({ mode: 'default' }))).toBe(false)
    expect(claudeAutoDefaultNoticeEligible(tab({ mode: null }))).toBe(false)
    expect(claudeAutoDefaultNoticeEligible(tab({ gate: 'finding' }))).toBe(false)
    expect(claudeAutoDefaultNoticeEligible(tab({ gate: 'off' }))).toBe(false)
    expect(claudeAutoDefaultNoticeEligible(tab({ shown: false }))).toBe(false)
  })

  // Which component mounts it is structure (CLAUDE.md rule 6): the pill row, mounted with the chat.
  it('is mounted by the session pill row, which the chat mounts', () => {
    const source = readFileSync(path.join(import.meta.dirname, 'MobileSessionPillRow.tsx'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
      .join('\n')
    expect(source).toMatch(/<MobileClaudeAutoDefaultNotice eligible=\{claudeAutoDefaultNoticeEligible\(controller\.nativeChatController\)\} \/>/)
  })
})
