import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Home's Artifacts card, the way into the account's Artifacts gallery (the Claude app's Artifacts
 * tab). It is there only while an Anthropic account is signed in on the phone: the gallery reads
 * with that sign-in, and with none it would open on nothing.
 */

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }))
vi.mock('lucide-react-native', () => ({ ChevronRight: 'ChevronRight' }))
vi.mock('../ui/PressScale', () => ({
  PressScale: (props: Record<string, unknown>) => createElement('PressScale', props)
}))

import { setAnthropicSignInReaderForTests } from '../session/anthropic-sign-in-presence'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { MobileHomeArtifactsCard } from './MobileHomeArtifactsCard'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  setAnthropicSignInReaderForTests(null)
  vi.restoreAllMocks()
})

async function render(signedIn: number | Error, scheme: 'light' | 'dark' = 'light', onOpen = vi.fn()): Promise<ReactTestInstance> {
  setAnthropicSignInReaderForTests(async () => {
    if (signedIn instanceof Error) {
      throw signedIn
    }
    return signedIn
  })
  await act(async () => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileHomeArtifactsCard onOpen={onOpen} />
      </ThemeProvider>
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
  return renderer!.root
}

const card = (root: ReactTestInstance) => root.findAll((node) => node.props.testID === 'home-artifacts-card' && String(node.type) === 'PressScale')[0]
const texts = (node: ReactTestInstance) => node.findAll((child) => String(child.type) === 'Text').map((child) => [child.props.children].flat().join(''))
function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}

describe("Home's Artifacts card", () => {
  it('is not drawn with nobody signed in to Anthropic', async () => {
    expect(card(await render(0))).toBeUndefined()
  })

  it('draws no heading of its own with nobody signed in, so home shows no empty Artifacts section', async () => {
    const root = await render(0)
    expect(texts(root)).toEqual([])
  })

  it('sits under its own Artifacts heading on home, not inside the Tasks section', async () => {
    const root = await render(1)
    const all = texts(root)
    const inCard = texts(card(root)!)
    // The heading comes first and is outside the card; the card follows it.
    expect(all).toEqual(['Artifacts', ...inCard])
    expect(flat(card(root)!.props.style).marginTop).toBeUndefined()
  })

  it('is not drawn when the sign-ins cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(card(await render(new Error('locked')))).toBeUndefined()
  })

  it('is drawn with one account signed in, with the artifacts glyph, and opens the gallery', async () => {
    const onOpen = vi.fn()
    const found = card(await render(1, 'light', onOpen))!
    expect(texts(found)).toEqual(['Artifacts', 'Yours and shared with you'])
    expect(found.findAll((node) => String(node.type) === 'Svg')).toHaveLength(1)
    found.props.onPress()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws its surface and glyph from the %s theme', async (scheme, colors) => {
    const found = card(await render(2, scheme))!
    expect(flat(found.props.style)).toMatchObject({ backgroundColor: colors.bgPanel, borderColor: colors.border })
    expect(found.findAll((node) => String(node.type) === 'Path')[0]!.props.fill).toBe(colors.textSecondary)
  })
})
