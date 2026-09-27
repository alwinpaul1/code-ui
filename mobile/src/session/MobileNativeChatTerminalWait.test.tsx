import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import ts from 'typescript'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))
vi.mock('lucide-react-native', () => ({ SquareTerminal: 'SquareTerminal' }))
// The other cards are not under test; each wins over the notice.
vi.mock('./MobileNativeChatPermission', () => ({ MobileNativeChatPermission: 'Permission' }))
vi.mock('./MobileNativeChatQuestion', () => ({ MobileNativeChatQuestion: 'Question' }))
vi.mock('./MobileNativeChatAsk', () => ({ MobileNativeChatAsk: 'Ask' }))

import { MobileNativeChatPromptCard, type MobileNativeChatPromptCardProps } from './MobileNativeChatPromptCard'
import { TERMINAL_MENU_TITLE, TERMINAL_WAIT_BODY, TERMINAL_WAIT_TITLE } from './MobileNativeChatTerminalWait'
import type { NativeChatTerminalWait } from './mobile-terminal-permission-options-merge'

const SCREEN_WAIT: NativeChatTerminalWait = {
  source: 'screen',
  kind: 'approval',
  choices: ['Yes', 'Yes, and don\u2019t ask again for: git *', 'No']
}
// Codex 0.153.4's model picker, open on the desktop (codex-picker-screen.test.ts).
const MENU_WAIT: NativeChatTerminalWait = {
  source: 'screen',
  kind: 'menu',
  choices: ['gpt-6-astra (default)  Our most capable model for complex, demanding work.']
}

// 2026-09-27: a background subagent's Bash prompt waited eight hours behind a
// chat that showed "1 running task" and nothing else. When the agent waits on
// a prompt the chat has no card for, the dock says so where the card would be.
describe('the dock while the agent waits on a prompt the chat cannot show', () => {
  let renderer: ReactTestRenderer | null = null
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    warn.mockClear()
  })
  afterAll(() => warn.mockRestore())

  function render(scheme: 'light' | 'dark', props: MobileNativeChatPromptCardProps) {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileNativeChatPromptCard {...props} />
        </ThemeProvider>
      )
    })
    return renderer!
  }

  it.each(['light', 'dark'] as const)(
    'says the agent is waiting for approval in the terminal and opens it, in %s',
    (scheme) => {
      const colors = scheme === 'dark' ? darkColors : lightColors
      const onOpenTerminal = vi.fn()
      const root = render(scheme, { terminalWait: SCREEN_WAIT, onOpenTerminal }).root
      const notice = root.findByProps({ testID: 'native-chat-terminal-wait' })
      expect(notice.props.accessibilityRole).toBe('alert')
      expect(JSON.stringify(root.findAll((node) => String(node.type) === 'Text').map((node) => node.props.children))).toContain(
        TERMINAL_WAIT_TITLE
      )
      expect(JSON.stringify(root.findAll((node) => String(node.type) === 'Text').map((node) => node.props.children))).toContain(
        TERMINAL_WAIT_BODY
      )
      // Every surface from the theme that is on, never a fixed palette.
      expect(notice.props.style).toMatchObject({
        backgroundColor: colors.bgPanel,
        borderColor: colors.border
      })
      expect(root.find((node) => String(node.type) === 'SquareTerminal').props.color).toBe(colors.accentText)
      const open = root.findByProps({ accessibilityLabel: 'Open terminal' })
      act(() => open.props.onPress())
      expect(onOpenTerminal).toHaveBeenCalledTimes(1)
    }
  )

  // The line it leaves behind names the dialog, once while it stays up, so a
  // prompt no reader took points at the readers the next time.
  it('leaves one line naming the dialog no card could show', () => {
    render('light', { terminalWait: SCREEN_WAIT, onOpenTerminal: vi.fn() })
    act(() =>
      renderer!.update(
        <ThemeProvider initialPreference="light">
          <MobileNativeChatPromptCard terminalWait={{ ...SCREEN_WAIT }} onOpenTerminal={vi.fn()} />
        </ThemeProvider>
      )
    )
    const said = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('[permission]'))
    expect(said).toEqual([
      '[permission] no card for the approval on screen (Yes | Yes, and don\u2019t ask again for: git * | No); the chat points to the terminal'
    ])
  })

  // A picker is not an approval: "Waiting for approval" sent the user looking
  // for a prompt that was never there (independent review, 2026-09-27).
  it.each(['light', 'dark'] as const)('says a menu is open in the terminal for an open picker, in %s', (scheme) => {
    const colors = scheme === 'dark' ? darkColors : lightColors
    const root = render(scheme, { terminalWait: MENU_WAIT, onOpenTerminal: vi.fn() }).root
    const texts = JSON.stringify(root.findAll((node) => String(node.type) === 'Text').map((node) => node.props.children))
    expect(texts).toContain(TERMINAL_MENU_TITLE)
    expect(texts).not.toContain(TERMINAL_WAIT_TITLE)
    expect(root.findByProps({ testID: 'native-chat-terminal-wait' }).props.style).toMatchObject({
      backgroundColor: colors.bgPanel
    })
  })

  it('says so from the hook alone, the same way', () => {
    const root = render('light', { terminalWait: { source: 'hook' }, onOpenTerminal: vi.fn() }).root
    expect(root.findAllByProps({ testID: 'native-chat-terminal-wait' })).toHaveLength(1)
  })

  it('gives way to any card that can answer the prompt', () => {
    const permission = { title: 'Allow Bash?', options: [{ label: 'Yes', send: '1' }] }
    const root = render('light', { terminalWait: SCREEN_WAIT, permission }).root
    expect(root.findAll((node) => String(node.type) === 'Permission')).toHaveLength(1)
    expect(root.findAllByProps({ testID: 'native-chat-terminal-wait' })).toHaveLength(0)
  })

  it('draws nothing while nothing waits', () => {
    expect(render('light', { terminalWait: null }).toJSON()).toBeNull()
  })
})

// The notice is only as good as the wiring that reaches it: the controller
// computes the wait, and it must travel overlay → view → prompt card. Each
// prop is optional, so the types cannot see a hop dropping it.
describe('the wait reaches the dock', () => {
  function jsxAttributes(file: string, tag: string): Map<string, string> {
    const path = fileURLToPath(new URL(`./${file}`, import.meta.url))
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const found = new Map<string, string>()
    const visit = (node: ts.Node): void => {
      const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null
      if (opening && opening.tagName.getText() === tag) {
        for (const property of opening.attributes.properties) {
          if (ts.isJsxAttribute(property)) {
            found.set(property.name.getText(), property.initializer?.getText() ?? '')
          } else if (ts.isObjectLiteralExpression(property.expression)) {
            // `{...{ permission, onRespondPermission }}`: shorthand names.
            for (const entry of property.expression.properties) {
              found.set(entry.name?.getText() ?? '', entry.getText())
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  }

  it('from the controller into the chat view', () => {
    const view = jsxAttributes('MobileNativeChatOverlay.tsx', 'MobileNativeChatView')
    expect(view.get('terminalWait')).toBe('{controller.nativeChatTerminalWait}')
    expect(view.get('onOpenTerminal')).toBe('{controller.openNativeChatTerminal}')
  })

  it('from the chat view into the prompt card in the dock', () => {
    const card = jsxAttributes('MobileNativeChatView.tsx', 'MobileNativeChatPromptCard')
    expect(card.get('terminalWait')).toBe('terminalWait')
    expect(card.get('onOpenTerminal')).toBe('onOpenTerminal')
  })
})
