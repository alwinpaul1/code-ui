import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseClaudeModelList } from '../../../src/shared/claude-model-list-probe'
import type { SessionOptionDescriptor } from '../../../src/shared/native-chat-session-options'
import { darkColors, lightColors } from '../theme/tokens'
import { claudePickerPalette } from '../theme/claude-picker-palette'
import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatSessionOptionPickers } from './MobileNativeChatSessionOptionPickers'
import type { MobileNativeChatSessionOptionsController } from './use-mobile-native-chat-session-options'

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
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({
      visible,
      onClose,
      children
    }: {
      visible: boolean
      onClose: () => void
      children?: React.ReactNode
    }) => (visible ? React.createElement('BottomDrawer', { visible, onClose }, children) : null)
  }
})

// The model rows exactly as Claude Code 2.1.295 lists them (captured
// 2026-10-09), the list behind the Claude app picker this sheet copies.
const CHOICES = parseClaudeModelList(
  readFileSync(join(__dirname, 'fixtures', 'claude-list-models-2.1.295.jsonl'), 'utf8')
).map((model) => ({
  value: model.id,
  label: model.label,
  ...(model.description ? { description: model.description } : {})
}))

const model = (currentValue: string): SessionOptionDescriptor => ({
  id: 'model',
  label: 'Model',
  category: 'model',
  kind: { type: 'select', currentValue, choices: CHOICES },
  valueSource: 'reported',
  transport: 'catalog',
  settable: true
})

const EFFORT: SessionOptionDescriptor = {
  id: 'effort',
  label: 'Effort',
  category: 'thought_level',
  kind: {
    type: 'select',
    currentValue: 'medium',
    choices: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' }
    ]
  },
  valueSource: 'reported',
  transport: 'catalog',
  settable: true
}

let renderer: ReactTestRenderer | null = null
const setOption = vi.fn<MobileNativeChatSessionOptionsController['setOption']>()

function mount(
  currentValue: string,
  scheme: 'light' | 'dark' = 'light',
  claudeModelLayout = true
): void {
  const controller: MobileNativeChatSessionOptionsController = {
    snapshot: [model(currentValue), EFFORT],
    pendingId: null,
    setOption,
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
          claudeModelLayout
        })}
      </ThemeProvider>
    )
  })
}

function press(node: ReactTestInstance): Promise<void> {
  return act(async () => (node.props as { onPress: () => void }).onPress())
}

function pressable(name: string): ReactTestInstance {
  return renderer!.root.find(
    (node) =>
      (node.type as unknown) === 'Pressable' &&
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.startsWith(name)
  )
}

function choiceRows(): ReactTestInstance[] {
  return renderer!.root.findAll(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'radio'
  )
}

function texts(node: ReactTestInstance): string[] {
  return node.findAllByType('Text' as never).map((text) => String(text.props.children))
}

function rowLabelled(label: string): ReactTestInstance {
  const row = choiceRows().find((candidate) => texts(candidate)[0] === label)
  if (!row) {
    throw new Error(`no row labelled ${label}`)
  }
  return row
}

function title(): string {
  return renderer!.root
    .findAllByType('Text' as never)
    .map((text) => String(text.props.children))
    .find((text) => text === 'Select model' || text === 'More models' || text === 'Effort')!
}

async function openSheet(): Promise<void> {
  await press(pressable('Model, '))
}

describe('the model sheet laid out as the Claude app picker', () => {
  beforeEach(() => {
    setOption.mockReset()
    setOption.mockResolvedValue(true)
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('shows the four newest models first, each with its tagline', async () => {
    mount('opus')
    await openSheet()
    expect(title()).toBe('Select model')
    expect(choiceRows().slice(0, 4).map(texts)).toEqual([
      ['Fable 5.1', 'For your toughest challenges'],
      ['Opus 5.5', 'For complex work and everyday tasks'],
      ['Sonnet 5.5', 'Most efficient for simpler tasks'],
      ['Haiku 5.5', 'Fastest for quick answers']
    ])
    expect(rowLabelled('Opus 5.5').props.accessibilityState.checked).toBe(true)
  })

  it('draws the check on the running row only, at the right', async () => {
    mount('opus')
    await openSheet()
    for (const row of choiceRows()) {
      const checks = row.findAllByType('Check' as never)
      expect(checks.length).toBe(texts(row)[0] === 'Opus 5.5' ? 1 : 0)
    }
    const opus = rowLabelled('Opus 5.5')
    const children = opus.children as ReactTestInstance[]
    expect((children.at(-1)!.type as unknown) === 'Check').toBe(true)
  })

  // The Claude app's chat picker (1.261009.20, ModelSelectorBottomSheetDestination):
  // "Select model" lists the featured models, then an Effort row, then a "More
  // models" row that opens a page of its own titled "More models". The user
  // (2026-10-14): "I had to click and see old models, like in Claude mobile."
  it('puts older models behind a tap, as the Claude app does', async () => {
    mount('opus')
    await openSheet()
    expect(title()).toBe('Select model')
    expect(choiceRows().map((row) => texts(row)[0])).toEqual([
      'Fable 5.1',
      'Opus 5.5',
      'Sonnet 5.5',
      'Haiku 5.5'
    ])
    const shown = renderer!.root.findAllByType('Text' as never).map((t) => String(t.props.children))
    expect(shown).not.toContain('Other models')
    expect(shown).not.toContain('Opus 4.8')
    expect(pressable('More models').props.accessibilityLabel).toBe('More models')
  })

  it('keeps Effort under the featured models and More models after it', async () => {
    mount('opus')
    await openSheet()
    expect(pressable('Effort').props.accessibilityLabel).toBe('Effort, Medium')
    const shown = renderer!.root.findAllByType('Text' as never).map((t) => String(t.props.children))
    expect(shown.indexOf('Haiku 5.5')).toBeLessThan(shown.indexOf('Effort'))
    expect(shown.indexOf('Effort')).toBeLessThan(shown.lastIndexOf('More models'))
  })

  it('opens the older models on their own page, names alone, and picks one', async () => {
    mount('opus')
    await openSheet()
    await press(pressable('More models'))
    expect(title()).toBe('More models')
    expect(choiceRows().map((row) => texts(row)[0])).toEqual([
      'Fable 5',
      'Opus 5',
      'Opus 4.8',
      'Opus 4.7',
      'Opus 4.6',
      'Sonnet 5',
      'Sonnet 4.6',
      'Haiku 4.5'
    ])
    // The second page lists names alone, as the app does.
    expect(choiceRows().every((row) => texts(row).length === 1)).toBe(true)
    await press(rowLabelled('Opus 4.8'))
    expect(setOption).toHaveBeenCalledWith('model', 'claude-opus-4-8', expect.any(Function))
  })

  it('goes back from More models to the first page', async () => {
    mount('opus')
    await openSheet()
    await press(pressable('More models'))
    await press(pressable('Back to models'))
    expect(title()).toBe('Select model')
    expect(choiceRows()).toHaveLength(4)
  })

  it('names an older running model on the More models row, and checks it there', async () => {
    mount('claude-opus-4-8')
    await openSheet()
    expect(choiceRows().some((row) => row.props.accessibilityState.checked)).toBe(false)
    expect(pressable('More models').props.accessibilityLabel).toBe('More models, Opus 4.8')
    await press(pressable('More models'))
    expect(rowLabelled('Opus 4.8').props.accessibilityState.checked).toBe(true)
  })

  it('leaves the More models row bare while a featured model runs', async () => {
    mount('opus')
    await openSheet()
    expect(pressable('More models').props.accessibilityLabel).toBe('More models')
    await press(pressable('More models'))
    expect(choiceRows().some((row) => row.props.accessibilityState.checked)).toBe(false)
  })

  // A model is half the choice and its effort the other half, so an older pick
  // steps into Effort too, and Back from there is the first page.
  it('lands on Effort after an older pick, and Back goes to the first page', async () => {
    mount('opus')
    await openSheet()
    await press(pressable('More models'))
    await press(rowLabelled('Opus 4.8'))
    expect(title()).toBe('Effort')
    await press(pressable('Back to models'))
    expect(title()).toBe('Select model')
    expect(choiceRows()).toHaveLength(4)
  })

  // Failure path: a refused pick keeps the page it was made on, so the user can
  // choose again; it must not drop them on the first page or on Effort.
  it('stays on More models when the agent refuses the pick', async () => {
    setOption.mockResolvedValue(false)
    mount('opus')
    await openSheet()
    await press(pressable('More models'))
    await press(rowLabelled('Opus 4.8'))
    expect(setOption).toHaveBeenCalledTimes(1)
    expect(title()).toBe('More models')
    expect(choiceRows()).toHaveLength(8)
  })

  it('titles the effort sheet "Effort", as the Claude app does, and goes back to the models', async () => {
    mount('opus')
    await openSheet()
    await press(pressable('Effort'))
    expect(title()).toBe('Effort')
    await press(pressable('Back to models'))
    expect(title()).toBe('Select model')
  })

  it('opens on the first page again after closing on the second', async () => {
    mount('opus')
    await openSheet()
    await press(pressable('More models'))
    // Swiped down or tapped outside: the drawer's own close, not Back.
    await act(async () => renderer!.root.findByType('BottomDrawer' as never).props.onClose())
    expect(renderer!.root.findAllByType('BottomDrawer' as never)).toHaveLength(0)
    await openSheet()
    expect(title()).toBe('Select model')
    expect(choiceRows()).toHaveLength(4)
  })

  it('opens on the first page again after closing on the effort sheet', async () => {
    mount('opus')
    await openSheet()
    await press(pressable('Effort'))
    await act(async () => renderer!.root.findByType('BottomDrawer' as never).props.onClose())
    await openSheet()
    expect(title()).toBe('Select model')
  })

  // Degenerate sizes: the row is there only when there is something behind it.
  describe('with a list too short to split', () => {
    function mountList(choices: typeof CHOICES): void {
      const descriptor: SessionOptionDescriptor = {
        ...model('opus'),
        kind: { type: 'select', currentValue: 'opus', choices }
      }
      act(() => {
        renderer = create(
          <ThemeProvider initialPreference="light">
            {createElement(MobileNativeChatSessionOptionPickers, {
              controller: {
                snapshot: [descriptor, EFFORT],
                pendingId: null,
                setOption,
                invokeAction: vi.fn(),
                recordCommand: vi.fn()
              },
              isWorking: false,
              reportFailure: vi.fn(),
              scopeKey: 'host\0wt\0tab',
              claudeModelLayout: true
            })}
          </ThemeProvider>
        )
      })
    }
    const moreRows = (): ReactTestInstance[] =>
      renderer!.root.findAll((node) =>
        String(node.props.accessibilityLabel ?? '').startsWith('More models')
      )

    it('shows no More models row when every model is featured', async () => {
      mountList(CHOICES.filter((choice) => ['opus', 'fable', 'sonnet', 'haiku'].includes(choice.value)))
      await openSheet()
      expect(choiceRows()).toHaveLength(4)
      expect(moreRows()).toEqual([])
    })

    it('draws one model alone, with no More models row', async () => {
      mountList(CHOICES.filter((choice) => choice.value === 'opus'))
      await openSheet()
      expect(choiceRows().map((row) => texts(row)[0])).toEqual(['Opus 5.5'])
      expect(moreRows()).toEqual([])
    })

    it('draws an empty list without rows or a More models row', async () => {
      mountList([])
      await openSheet()
      expect(title()).toBe('Select model')
      expect(choiceRows()).toEqual([])
      expect(moreRows()).toEqual([])
    })
  })

  // OMP labels its rows with the model's own name ("Claude Opus 4.5") and
  // tells same-named rows apart only by the provider in the description, so
  // only Claude's list is ever split (review, 2026-10-09).
  it('lists another agent flat even when its rows name Claude models', async () => {
    mount('opus', 'light', false)
    await openSheet()
    expect(choiceRows()).toHaveLength(CHOICES.length)
    expect(renderer!.root.findAll((node) => node.props.accessibilityLabel === 'More models')).toEqual([])
  })

  // Light tiles are the panel colour, lighter than the sheet, outlined by the
  // border colour showing through the gaps; bgRaised on bg read 1.09:1.
  it.each([
    ['light', lightColors, lightColors.bgPanel],
    ['dark', darkColors, darkColors.bgRaised]
  ] as const)('paints rows and check from the %s theme', async (scheme, palette, tile) => {
    mount('opus', scheme)
    await openSheet()
    const opus = rowLabelled('Opus 5.5')
    const style = (opus.props.style as (state: { pressed: boolean }) => Record<string, unknown>)({
      pressed: false
    })
    expect(style.backgroundColor).toBe(tile)
    expect(opus.findByType('Check' as never).props.color).toBe(claudePickerPalette(scheme).check)
    let group = opus.parent
    while (group && (group.type as unknown) !== 'View') {
      group = group.parent
    }
    expect(group!.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: palette.border })])
    )
  })

  // The More models row and the page behind it are tiles like the rest: both
  // paint from the theme, in light and in dark.
  it.each([
    ['light', lightColors, lightColors.bgPanel],
    ['dark', darkColors, darkColors.bgRaised]
  ] as const)('paints the More models row and its page from the %s theme', async (scheme, palette, tile) => {
    mount('claude-opus-4-8', scheme)
    await openSheet()
    const row = pressable('More models')
    const style = (row.props.style as (state: { pressed: boolean }) => Record<string, unknown>)({
      pressed: false
    })
    expect(style.backgroundColor).toBe(tile)
    expect(row.findByType('ChevronRight' as never).props.color).toBe(palette.textMuted)
    await press(row)
    const older = rowLabelled('Opus 4.8')
    const olderStyle = (
      older.props.style as (state: { pressed: boolean }) => Record<string, unknown>
    )({ pressed: false })
    expect(olderStyle.backgroundColor).toBe(tile)
    expect(older.findByType('Check' as never).props.color).toBe(claudePickerPalette(scheme).check)
  })
})
