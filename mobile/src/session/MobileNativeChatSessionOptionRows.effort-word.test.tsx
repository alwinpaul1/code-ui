import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatSessionOptionPickers } from './MobileNativeChatSessionOptionPickers'
import { Pill } from './MobileNativeChatSessionOptionRows'
import { sessionModelPillLabel, sessionModelPillParts } from './session-model-pill'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'

// The Claude app's model chip draws the model's name in `pl7.O` and the effort after it in
// `pl7.P` (1.261009.20, `md6.a`; docs/claude-app-parity-gaps.md, "Still differs: the chip's
// effort word is not muted"). Code UI built one label string, "Opus 5.5 Extra", in one tone.
// `pl7.O` is `composerPillText` and `pl7.P` is `composerIcon`: #1E1C19 and #383835 in light,
// #F8F8F6 and #C3C2B7 in dark.
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Keyboard: { dismiss: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ArrowLeft: 'ArrowLeft',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  X: 'X'
}))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: () => null }))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function colourOf(style: unknown): unknown {
  let colour: unknown
  for (const entry of [style].flat(Infinity) as Array<Record<string, unknown> | null | undefined>) {
    if (entry && 'color' in entry) {
      colour = entry.color
    }
  }
  return colour
}

const pill = (name: string): ReactTestInstance =>
  renderer!.root.find(
    (node) =>
      (node.type as unknown) === 'Pressable' &&
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith(name)
  )
const texts = (): ReactTestInstance[] => pill('Model, ').findAllByType('Text' as never)

describe('what the model chip is made of', () => {
  it('splits the agent’s name from its effort, and still joins them for the one-string label', () => {
    const live = { model: 'claude-opus-5-5', label: 'Opus 5.5 (1M context)', effort: 'xhigh' }
    expect(sessionModelPillParts(live)).toEqual({ name: 'Opus 5.5', effort: 'Extra' })
    expect(sessionModelPillLabel(live)).toBe('Opus 5.5 Extra')
  })

  it('has no effort part where the agent stated none, and no parts where it named no model', () => {
    expect(sessionModelPillParts({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: null })).toEqual({
      name: 'Opus 5.5',
      effort: null
    })
    expect(sessionModelPillParts({ model: 'claude-opus-5-5', label: 'Opus 5.5', effort: '  ' })).toMatchObject({
      effort: null
    })
    expect(sessionModelPillParts({ model: null, label: 'Opus 5.5', effort: 'xhigh' })).toBeNull()
    expect(sessionModelPillParts(null)).toBeNull()
  })
})

describe.each<['light' | 'dark', ThemeColors]>([
  ['light', lightColors],
  ['dark', darkColors]
])('the model chip’s effort word in %s', (scheme, colors) => {
  function renderPill(props: { effort?: string | null; disabled?: boolean }): void {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <Pill
            label="Opus 5.5"
            effort={props.effort}
            accessibleName="Model, Opus 5.5 Extra"
            disabled={props.disabled ?? false}
            onPress={() => {}}
          />
        </ThemeProvider>
      )
    })
  }

  it('is drawn after the name in the muted tone, the name staying in the primary one', () => {
    renderPill({ effort: 'Extra' })
    const [label, effort] = texts()
    expect(colourOf(label!.props.style)).toBe(colors.composerPillText)
    expect(effort!.props.children).toBe(' Extra')
    expect(colourOf(effort!.props.style)).toBe(colors.composerIcon)
    // The two tones are two tokens, or the word would not read as muted.
    expect(colors.composerIcon).not.toBe(colors.composerPillText)
  })

  it('stays on the chip’s single 13 / 400 line, so a long label still ellipsizes as one', () => {
    renderPill({ effort: 'Extra' })
    const [label, effort] = texts()
    expect(label!.props.numberOfLines).toBe(1)
    expect(label!.props.ellipsizeMode).toBe('tail')
    // The word is nested in the label's own Text, so the line breaks, and ellipsizes, as one.
    expect(label!.findAllByType('Text' as never)).toContain(effort)
  })

  it('is one piece of text to a screen reader: the chip is named by the whole label', () => {
    renderPill({ effort: 'Extra' })
    expect(pill('Model, ').props.accessibilityLabel).toBe('Model, Opus 5.5 Extra')
  })

  it.each<[string, string | null | undefined]>([
    ['null', null],
    ['absent', undefined],
    ['empty', '']
  ])('draws no second text with an effort that is %s', (_name, effort) => {
    renderPill({ effort })
    expect(texts()).toHaveLength(1)
  })

  it('goes quiet with the rest of the chip while it is disabled', () => {
    renderPill({ effort: 'Extra', disabled: true })
    const [, effort] = texts()
    expect(colourOf(effort!.props.style)).toBe(colors.textMuted)
  })
})

const MODEL: SessionOptionDescriptor = {
  id: 'model',
  label: 'Model',
  category: 'model',
  kind: {
    type: 'select',
    currentValue: 'opus',
    choices: [{ value: 'opus', label: 'Opus' }]
  },
  valueSource: 'reported',
  transport: 'catalog',
  settable: true
}

function mountPickers(
  scheme: 'light' | 'dark',
  liveModel: { model: string | null; label: string | null; effort: string | null } | undefined
): void {
  const controller: MobileNativeChatSessionOptionsController = {
    snapshot: [MODEL],
    pendingId: null,
    setOption: vi.fn(),
    invokeAction: vi.fn(),
    recordCommand: vi.fn()
  }
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        {createElement(MobileNativeChatSessionOptionPickers, {
          controller,
          isWorking: false,
          reportFailure: vi.fn(),
          scopeKey: 'host\0wt\0tab',
          liveModel
        })}
      </ThemeProvider>
    )
  })
}

describe.each<['light' | 'dark', ThemeColors]>([
  ['light', lightColors],
  ['dark', darkColors]
])('the composer’s model chip, from what the agent states, in %s', (scheme, colors) => {
  it('draws the agent’s effort muted after its name, the chip still named by both', () => {
    // The status line paints "Opus 5.5 (1M context) xhigh"; the chip says "Opus 5.5 Extra".
    mountPickers(scheme, { model: 'claude-opus-5-5', label: 'Opus 5.5 (1M context)', effort: 'xhigh' })
    expect(pill('Model, ').props.accessibilityLabel).toBe('Model, Opus 5.5 Extra')
    const [label, effort] = texts()
    // The name is the chip's own text; the effort is the Text nested after it.
    expect(label!.children[0]).toBe('Opus 5.5')
    expect(colourOf(label!.props.style)).toBe(colors.composerPillText)
    expect(effort!.props.children).toBe(' Extra')
    expect(colourOf(effort!.props.style)).toBe(colors.composerIcon)
  })

  it('draws the name alone, in the primary tone, when the agent stated no effort', () => {
    mountPickers(scheme, { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: null })
    expect(pill('Model, ').props.accessibilityLabel).toBe('Model, Opus 5.5')
    expect(texts()).toHaveLength(1)
    expect(colourOf(texts()[0]!.props.style)).toBe(colors.composerPillText)
  })

  it('leaves the snapshot’s label whole when the agent has stated nothing: no word is split off a guess', () => {
    mountPickers(scheme, undefined)
    expect(pill('Model, ').props.accessibilityLabel).toBe('Model, Opus')
    expect(texts()).toHaveLength(1)
  })
})
