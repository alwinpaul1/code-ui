// The question asked before a `!` message runs is drawn from the live theme in
// BOTH schemes: its title, the command, and the two buttons take their colours
// from `useTheme()` through ConfirmModal, and this file adds none of its own. A
// hardcoded colour would pass every other test and still draw the wrong theme.

import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android ?? o.default },
  useColorScheme: () => 'light'
}))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: ({ visible, children }: { visible: boolean; children: unknown }) =>
    visible ? children : null
}))

import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useMobileNativeChatShellCommandConfirm } from './use-mobile-native-chat-shell-command-confirm'

let renderer: ReactTestRenderer | null = null
/** The sheet is loaded lazily the first time a `!` message is sent. */
const flushLazy = async (): Promise<void> => {
  for (let wait = 0; wait < 100; wait++) {
    if (JSON.stringify(renderer?.toJSON() ?? null).includes('Run on the desktop?')) {
      return
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }
}
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

async function openIn(scheme: 'light' | 'dark'): Promise<ReactTestRenderer> {
  let api!: ReturnType<typeof useMobileNativeChatShellCommandConfirm>
  function Probe() {
    api = useMobileNativeChatShellCommandConfirm('claude', async () => true)
    return createElement('View', null, api.confirm)
  }
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <Probe />
      </ThemeProvider>
    )
  })
  await act(async () => {
    void api.send('!ls -la')
  })
  await flushLazy()
  return renderer!
}

const styleColors = (tree: ReactTestRenderer, key: 'backgroundColor' | 'color'): string[] =>
  tree.root
    .findAll((node) => node.props?.style !== undefined)
    .flatMap((node) => {
      const raw = node.props.style as unknown
      const flat = (Array.isArray(raw) ? raw.flat(3) : [raw]).filter(
        (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
      )
      return flat.flatMap((entry) => (typeof entry[key] === 'string' ? [entry[key] as string] : []))
    })

describe('the shell command question in light and dark', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('is drawn from the %s theme', async (scheme, colors) => {
    const tree = await openIn(scheme)
    const backgrounds = styleColors(tree, 'backgroundColor')
    const foregrounds = styleColors(tree, 'color')
    // Run is the danger button, Cancel the raised secondary one.
    expect(backgrounds).toContain(colors.danger)
    expect(backgrounds).toContain(colors.bgRaised)
    // The title and the command read from the scheme's text colours.
    expect(foregrounds).toContain(colors.text)
    expect(foregrounds).toContain(colors.textSecondary)
  })

  it('draws the two schemes differently', async () => {
    const light = styleColors(await openIn('light'), 'backgroundColor')
    act(() => renderer?.unmount())
    const dark = styleColors(await openIn('dark'), 'backgroundColor')
    expect(dark).not.toEqual(light)
  })
})
