import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => undefined }
}))
/** Function components rather than host strings, so a case can match a node by identity. */
const hosts = vi.hoisted(() => {
  const make = (name: string) => {
    const Host = (props: { children?: ReactNode }): ReactNode => props.children ?? null
    Host.displayName = name
    return Host
  }
  return {
    View: make('View'),
    Text: make('Text'),
    Pressable: make('Pressable'),
    TextInput: make('TextInput'),
    Switch: make('Switch')
  }
})

vi.mock('react-native', () => ({
  View: hosts.View,
  Text: hosts.Text,
  Pressable: hosts.Pressable,
  TextInput: hosts.TextInput,
  Switch: hosts.Switch,
  StyleSheet: { create: <T,>(styles: T) => styles, absoluteFillObject: {} },
  Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios }
}))
vi.mock('lucide-react-native', () => ({ ChevronLeft: hosts.View }))
vi.mock('./BottomDrawer', () => ({ BottomDrawer: hosts.View }))

import { CustomKeyModal, type CustomKey } from './CustomKeyModal'

const LONE_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function textsUnder(node: ReactTestRenderer['root']): string {
  return node
    .findAll((child) => child.type === hosts.Text)
    .flatMap((child) => [child.props.children].flat())
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
}

/** The pressable whose first line of text is `label` (a row carries a hint under it). */
function press(renderer: ReactTestRenderer, label: string): void {
  const target = renderer.root
    .findAll((node) => node.type === hosts.Pressable)
    .find((node) => textsUnder(node).trim().startsWith(label))
  const onPress = target?.props.onPress
  if (typeof onPress !== 'function') {
    throw new Error(`the modal rendered no pressable "${label}"`)
  }
  act(() => {
    onPress()
  })
}

/** Through the drawer as a user reaches it: Text Macro, the command typed with
 *  no label, then Add Shortcut. Returns the key the modal reported. */
async function addMacroWithoutALabel(command: string): Promise<CustomKey | undefined> {
  const onKeysChanged = vi.fn<(keys: CustomKey[]) => void>()
  let renderer: ReactTestRenderer | null = null
  act(() => {
    renderer = create(createElement(CustomKeyModal, { visible: true, onClose: () => {}, onKeysChanged }))
  })
  if (renderer === null) {
    throw new Error('the modal did not render')
  }
  const rendered: ReactTestRenderer = renderer
  press(rendered, 'Text Macro')
  const inputs = rendered.root.findAll((node) => node.type === hosts.TextInput)
  // Label first, then Command.
  act(() => {
    inputs[1]!.props.onChangeText(command)
  })
  press(rendered, 'Add Shortcut')
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  act(() => rendered.unmount())
  return onKeysChanged.mock.calls[0]?.[0].at(-1)
}

// A macro saved with no label is named after the first 12 UTF-16 code units of
// its command. An emoji is two, and a cut between them saved half of it as the
// key's name, a broken glyph on the accessory bar for as long as the key lives.
describe('a text macro named after its command', () => {
  it('keeps a rocket emoji whole in the key name when it straddles the cut', async () => {
    // "echo 'ship " is 11 code units: the rocket sits on 11 and 12.
    const key = await addMacroWithoutALabel("echo 'ship 🚀 it'")
    expect(key?.label).not.toMatch(LONE_HALF)
    expect(key?.label).toBe("echo 'ship ")
    // The macro itself is typed whole.
    expect(key?.bytes).toBe("echo 'ship 🚀 it'\r")
  })

  it('keeps an emoji that ends just before the cut', async () => {
    const key = await addMacroWithoutALabel("echo 'ship🚀 it'")
    expect(key?.label).toBe("echo 'ship🚀")
  })

  it('names a key after a command of exactly 12 code units whole, and cuts one a unit over', async () => {
    expect((await addMacroWithoutALabel("echo 'hi 🚀'"))?.label).toBe("echo 'hi 🚀'")
    // "echo 'hiya " is 11 code units, so the rocket makes it 13 and straddles 11 and 12.
    const over = await addMacroWithoutALabel("echo 'hiya 🚀")
    expect(over?.label).not.toMatch(LONE_HALF)
    expect(over?.label).toBe("echo 'hiya ")
  })

  it('adds nothing for an empty command', async () => {
    expect(await addMacroWithoutALabel('')).toBeUndefined()
  })

  it('cuts a command made only of emoji between two of them', async () => {
    const key = await addMacroWithoutALabel('🚀'.repeat(7))
    expect(key?.label).not.toMatch(LONE_HALF)
    expect(key?.label).toBe('🚀'.repeat(6))
    const odd = await addMacroWithoutALabel(`✅${'🚀'.repeat(7)}`)
    expect(odd?.label).not.toMatch(LONE_HALF)
    expect(odd?.label).toBe(`✅${'🚀'.repeat(5)}`)
  })
})
