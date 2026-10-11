import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatPermission } from './MobileNativeChatPermission'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  // The card sizes its reading area against the window so a long prompt cannot
  // push the choices off a short screen.
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))

vi.mock('lucide-react-native', () => ({
  FileMinus2: 'FileMinus2',
  FilePen: 'FilePen',
  FilePlus2: 'FilePlus2',
  ShieldQuestion: 'ShieldQuestion',
  X: 'X'
}))
vi.mock('../components/TextInputModal', () => ({ TextInputModal: 'TextInputModal' }))
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))

describe('the plan review on the card', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  // Real captured options, Claude Code 2.1.276 (claude-plan-permission.test.ts,
  // the review screen in mobile-native-chat-dialog-guard.test.ts).
  const planOptions = [
    { label: 'Yes, and use auto mode', send: '1' },
    { label: 'Yes, manually approve edits', send: '2' },
    { label: 'Tell Claude what to change', send: '3' }
  ]

    // The Claude app 1.261009.20 answers a plan with "Approve Plan" or
    // "Approve & auto mode" (ccr_plan_approval_approve, _approve_auto) and
    // "Suggest Edits", whose field reads "Describe what you’d like changed…"
    // (ccr_input_placeholder_suggest_edits). The card names Claude Code's
    // three choices that way and still sends each one's own digit.
    it.each(['light', 'dark'] as const)(
      'names the plan choices Approve & auto mode, Approve Plan and Suggest Edits, each sending its own key, in %s',
      async (scheme) => {
        const onRespond = vi.fn(async () => true)
        await act(async () => {
          renderer = create(
            createElement(
              ThemeProvider,
              { initialPreference: scheme },
              createElement(MobileNativeChatPermission, {
                permission: { title: 'Ready to code?', options: planOptions },
                onRespond,
                onRespondWithComment: vi.fn(async () => true)
              })
            )
          )
        })
        const buttons = renderer!.root.findAllByType('Pressable')
        const shown = buttons.map(
          (button) => button.findAllByType('Text').map((text) => text.props.children)[0]
        )
        expect(shown).toEqual(['Approve & auto mode', 'Approve Plan', 'Suggest Edits'])
        // The first is the filled one, from the theme in use.
        const palette = scheme === 'dark' ? darkColors : lightColors
        const first = [buttons[0]!.props.style].flat(Infinity) as { backgroundColor?: string }[]
        expect(first.some((entry) => entry?.backgroundColor === palette.text)).toBe(true)
        await act(async () => buttons[1]!.props.onPress())
        expect(onRespond).toHaveBeenCalledExactlyOnceWith('2')
        act(() => renderer?.unmount())
        renderer = null
      }
    )

    it('asks for the edits in the Claude app’s words', async () => {
      await act(async () => {
        renderer = create(
          createElement(MobileNativeChatPermission, {
            permission: { title: 'Ready to code?', options: planOptions },
            onRespond: vi.fn(async () => true),
            onRespondWithComment: vi.fn(async () => true)
          })
        )
      })
      const sheet = renderer!.root.findByType('TextInputModal')
      expect(sheet.props.title).toBe('Suggest Edits')
      expect(sheet.props.placeholder).toBe('Describe what you’d like changed…')
    })

    // Wordings this file has not seen on a real screen keep the agent's words:
    // a guessed mapping would put "Approve" on a choice that might not be one.
    it('keeps the agent’s own words on a plan choice it has not seen', async () => {
      await act(async () => {
        renderer = create(
          createElement(MobileNativeChatPermission, {
            permission: {
              title: 'Ready to code?',
              options: [
                { label: 'Yes, clear context and auto-accept edits', send: '1' },
                ...planOptions.slice(1)
              ]
            },
            onRespond: vi.fn(async () => true),
            onRespondWithComment: vi.fn(async () => true)
          })
        )
      })
      const shown = renderer!.root
        .findAllByType('Pressable')
        .map((button) => button.findAllByType('Text').map((text) => text.props.children)[0])
      expect(shown).toEqual(['Yes, clear context and auto-accept edits', 'Approve Plan', 'Suggest Edits'])
    })
})
