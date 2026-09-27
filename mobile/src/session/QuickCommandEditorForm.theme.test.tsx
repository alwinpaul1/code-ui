import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The Quick Command editor (add/edit a quick command from the session's tab strip) in both
 * themes. It painted from the LEGACY static palette (`mobile-theme.ts`), dark-only, until the
 * 2026-09-27 sweep. This pins its labels, inputs, the Action toggle's selected and resting items,
 * and the Save button (an inverse surface with its own label colour).
 */

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ ChevronDown: 'ChevronDown', ChevronRight: 'ChevronRight' }))
vi.mock('../components/MobileAgentIcon', () => ({ MobileAgentIcon: () => null }))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import { QuickCommandEditorForm } from './QuickCommandEditorForm'
import type { QuickCommandDraft } from './quick-command-draft'

const DRAFT: QuickCommandDraft = {
  id: null,
  label: 'Start dev server',
  action: 'terminal-command',
  command: 'npm run dev',
  appendEnter: true,
  agent: null,
  prompt: '',
  scope: { type: 'global' }
}

function flat(style: unknown): Record<string, unknown> {
  const raw = typeof style === 'function' ? style({ pressed: false }) : style
  const list = Array.isArray(raw) ? raw.flat(Infinity) : [raw]
  return Object.assign(
    {},
    ...list.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
  )
}

describe('the Quick Command editor', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws its fields, toggle and Save button from the %s theme', (scheme, palette) => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <QuickCommandEditorForm
            draft={DRAFT}
            mode="add"
            saving={false}
            error={null}
            repoId={null}
            repoName={null}
            onChange={() => undefined}
            onOpenAgentPicker={() => undefined}
            onCancel={() => undefined}
            onSave={() => undefined}
          />
        </ThemeProvider>
      )
    })
    const root = renderer!.root
    const text = (children: string): ReactTestInstance =>
      root.find((node) => String(node.type) === 'Text' && node.props.children === children)

    expect(flat(text('Label').props.style).color).toBe(palette.textSecondary)
    const [labelInput] = root.findAll((node) => String(node.type) === 'TextInput')
    expect(flat(labelInput!.props.style)).toMatchObject({
      backgroundColor: palette.bgPanel,
      borderColor: palette.border,
      color: palette.text
    })
    expect(labelInput!.props.placeholderTextColor).toBe(palette.textMuted)

    // The Action toggle: "Terminal Command" is selected, "Agent Prompt" rests.
    expect(flat(text('Terminal Command').props.style).color).toBe(palette.text)
    expect(flat(text('Terminal Command').parent!.props.style).backgroundColor).toBe(palette.bgRaised)
    expect(flat(text('Agent Prompt').props.style).color).toBe(palette.textSecondary)
    expect(flat(text('Agent Prompt').parent!.props.style).backgroundColor).toBe(palette.bgPanel)

    const save = text('Add Quick Command')
    expect(flat(save.props.style).color).toBe(palette.textInverse)
    expect(flat(save.parent!.props.style).backgroundColor).toBe(palette.text)
    expect(flat(text('Cancel').props.style).color).toBe(palette.text)
  })
})
