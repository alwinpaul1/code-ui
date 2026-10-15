import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { claudeSessionPillPalette } from '../theme/claude-session-pill-palette'
import { darkColors, lightColors } from '../theme/tokens'

// The Claude app's "Plan" pill in its session bar (1.261013.20: `session_pill_plan` "Plan", read
// "Open plan" `ccr_session_bar_open_plan`, ns30.java:610-651, u8z.java:3806), the same generic chip
// as the other pills, opening the plan under the title "Plan" (`ccr_plan_view_title`).

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Linking: { openURL: vi.fn(async () => {}) },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true })
)
vi.mock('../components/ActionSheetModal', () => ({ ActionSheetModal: () => null }))
vi.mock('../components/BottomDrawer', () => ({
  BottomDrawer: (props: { visible: boolean; header: unknown; children: unknown }) =>
    props.visible ? createElement('Drawer', null, props.header as never, props.children as never) : null
}))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: (props: { content: string }) => createElement('Markdown', { content: props.content }) }))
vi.mock('./MobileSheetTitleBar', () => ({ MobileSheetTitleBar: (props: { title: string }) => createElement('TitleBar', { title: props.title }) }))
vi.mock('../platform/clipboard', () => ({ useClipboardWriter: () => ({ writeText: async () => {} }) }))
vi.mock('./use-session-pills', () => ({ useSessionPills: () => [] }))

import { ThemeProvider } from '../theme/theme-context'
import { MobileSessionPillRow, SessionPillRowView } from './MobileSessionPillRow'
import type { MobileSessionController } from './use-mobile-session-controller'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter((entry) => entry && typeof entry === 'object'))
}
const host = (id: string): ReactTestInstance | undefined =>
  renderer!.root.findAll((node) => node.props.testID === id && typeof node.type === 'string')[0]
const texts = (node: ReactTestInstance): string[] =>
  node.findAll((child) => (child.type as unknown) === 'Text').map((child) => [child.props.children].flat().join(''))

describe.each(['light', 'dark'] as const)('the Plan pill in %s mode', (scheme) => {
  const colors = scheme === 'light' ? lightColors : darkColors
  const claude = claudeSessionPillPalette(scheme)

  it('draws "Plan" on the app’s chip, alone in the row, read "Open plan"', () => {
    const open = vi.fn()
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <SessionPillRowView pills={[]} onOpenPullRequest={vi.fn()} onCopyPrNumber={vi.fn()} onOpenPlan={open} />
        </ThemeProvider>
      )
    })
    const pill = host('plan-pill')!
    expect(pill).toBeDefined()
    expect(pill.props.accessibilityLabel).toBe('Open plan')
    expect(texts(pill)).toEqual(['Plan'])
    const style = pill.props.style
    expect(flat(typeof style === 'function' ? style({ pressed: false }) : style)).toMatchObject({
      backgroundColor: claude.surface,
      borderColor: claude.border,
      borderRadius: 14
    })
    const label = pill.find((child) => (child.type as unknown) === 'Text')
    expect(flat(label.props.style).color).toBe(colors.text)
    act(() => pill.props.onPress())
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe('the connected row', () => {
  const controller = (plan: string | null): MobileSessionController =>
    ({
      showToast: vi.fn(),
      handlePanelTap: vi.fn(),
      nativeChatController: { nativeChatClaudePlan: plan }
    }) as unknown as MobileSessionController
  const mount = (plan: string | null) =>
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <MobileSessionPillRow controller={controller(plan)} />
        </ThemeProvider>
      )
    })

  it('opens the plan Claude proposed under the title "Plan"', () => {
    mount('# Ship it\n\n1. Write the test')
    expect(renderer!.root.findAll((node) => (node.type as unknown) === 'Drawer')).toHaveLength(0)
    act(() => host('plan-pill')!.props.onPress())
    expect(renderer!.root.find((node) => (node.type as unknown) === 'TitleBar').props.title).toBe('Plan')
    expect(renderer!.root.find((node) => (node.type as unknown) === 'Markdown').props.content).toBe('# Ship it\n\n1. Write the test')
  })

  it('draws no pill and nothing at all with no plan and no other pill', () => {
    mount(null)
    expect(host('plan-pill')).toBeUndefined()
    expect(renderer!.toJSON()).toBeNull()
  })

  it('closes the sheet when the plan goes away (a new plan’s approval is asked)', () => {
    mount('# Plan')
    act(() => host('plan-pill')!.props.onPress())
    act(() =>
      renderer!.update(
        <ThemeProvider initialPreference="light">
          <MobileSessionPillRow controller={controller(null)} />
        </ThemeProvider>
      )
    )
    expect(renderer!.root.findAll((node) => (node.type as unknown) === 'Drawer')).toHaveLength(0)
    act(() =>
      renderer!.update(
        <ThemeProvider initialPreference="light">
          <MobileSessionPillRow controller={controller('# Plan two')} />
        </ThemeProvider>
      )
    )
    expect(renderer!.root.findAll((node) => (node.type as unknown) === 'Drawer')).toHaveLength(0)
  })
})
