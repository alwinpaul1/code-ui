import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createElement, type ComponentProps } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// G4, the Claude app's mode chip (1.261009.20, decompiled `x030.c`): in the composer's leading
// group, a circle of `pl7.x0` at least 36 dp tall with 16 x 4 dp padding; a 20 dp icon and a
// 13 / 400 one-line label, both in `pl7.O`, 4 dp apart; the whole chip at 40% when disabled;
// described to a screen reader as "Change mode" (`ccr_mode_toggle`). Icons by mode (`ky20.q`):
// Manual a hand, Accept edits code, Plan a scroll, Auto and Bypass a lightning bolt.
//
// What the screen states decides whether the chip is drawn at all. Every screen below is a real
// capture: Claude Code's footer rows as tmux and `terminal.read` painted them, and the shell a
// Claude tab shows once the agent has gone (tmux, 2026-10-02). The chip names a mode only where
// a footer stated one, and only on a Claude tab: Codex's footer states a different pair, and its
// parse fills a permission mode of `default` that would read "Manual" over a Plan session.

type Action = { label: string; hint?: string; selected?: boolean }
const sheet = vi.hoisted(() => ({
  latest: null as null | { visible: boolean; title?: string; actions: Action[] }
}))

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    FlatList: 'FlatList',
    Image: 'Image',
    Keyboard: { dismiss: () => {}, isVisible: () => false, addListener: () => ({ remove: () => {} }) },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, flatten: (s: unknown) => s, hairlineWidth: 1 },
    Switch: 'Switch',
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 384, height: 823 })
  }
})
vi.mock('react-native-svg', () => ({ default: () => null, Circle: () => null }))
vi.mock('lucide-react-native', () => new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true }))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: () => null }))
vi.mock('../components/ActionSheetModal', () => ({
  ActionSheetModal: (props: { visible: boolean; title?: string; actions: Action[] }) => {
    sheet.latest = props
    return null
  }
}))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors, type ThemeColors } from '../theme/tokens'
import { claudeBoxThenShell, SHELL_PROMPTS } from './fixtures/claude-exited-to-shell-2.1.287'
import { IDLE_AFTER_TURN_0158 } from './fixtures/codex-composer-screens'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import { MobileNativeChatModeChip, modeChipSpec } from './MobileNativeChatModeChip'
import {
  parseTerminalHudObservation,
  type TerminalAgentMode,
  type TerminalPermissionMode
} from './mobile-terminal-hud-parse'

function readCapture(file: string): string[] {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${file}`, import.meta.url)), 'utf8').split('\n')
}

const NBSP = ' '
const RULE_100 = '─'.repeat(100)
// Claude Code 2.1.270, `tmux capture-pane -p` on 2026-09-13, 100 columns, in manual mode: the
// footer row has no "shift+tab to cycle" hint.
const MANUAL_2_1_270 = [
  '⏺ done',
  '',
  '✻ Baked for 7s · done 10:25 AM',
  '',
  RULE_100,
  `❯${NBSP}`,
  RULE_100,
  '  [Haiku 4.5 | Max 20x] ██░░░░ 26% (52k/200k) | probe | 1 CLAUDE.md | 4 rules | 3 MCPs | 12 hooks',
  '  Usage ░░░░░░ 6% (resets 3:10 PM) | Weekly ███░░░ 46% (resets Wed 7:00 PM)',
  '  ───────────────────────────────────────────────────────────────────────────────────────────────',
  '  ✓ Bash ×1',
  '  ⏸ manual mode on · ← for agents'
]
// Claude Code 2.1.281 idle, tmux: the whole hint is painted.
const AUTO_2_1_281 = readCapture('claude-screen-sent-photos-2.1.281.txt')
// Claude Code 2.1.278 at 46 columns, tmux: the hint cut short.
const BYPASS_2_1_278 = readCapture('claude-screen-peer-message-2.1.278.txt')
// The accept-edits footer of a hand-started claude, `terminal.read` 2026-09-18, 2.1.281 composer.
const ACCEPT_EDITS_2026_09_18 = [RULE_100, '❯ ', RULE_100, '  ⏵⏵ accept edits on (shift+tab to cycle)']
// codex-cli 0.153.4's footer, live capture 2026-09-09, with its Plan hint.
const CODEX_PLAN_FOOTER = [
  '› Ask Codex to do anything',
  '  gpt-5.6-sol medium · ~/Project                          Plan mode (shift+tab to cycle)'
]

/** What the chat reads off a screen and hands the composer: the HUD observation's mode pair. */
function observed(lines: string[]): {
  permissionMode: TerminalPermissionMode | null
  agentMode: TerminalAgentMode | null
} {
  const observation = parseTerminalHudObservation(lines)
  return { permissionMode: observation?.permissionMode ?? null, agentMode: observation?.agentMode ?? null }
}

describe('the mode chip names a mode only where a Claude footer stated one', () => {
  it.each<[string, string[], TerminalPermissionMode, string, string]>([
    ['2.1.270 in manual mode, no hint', MANUAL_2_1_270, 'manual', 'Manual', 'Hand'],
    ['a hand-started claude in accept edits', ACCEPT_EDITS_2026_09_18, 'acceptEdits', 'Accept edits', 'Code'],
    ['2.1.281 in auto mode', AUTO_2_1_281, 'auto', 'Auto', 'Zap'],
    ['2.1.278 at 46 columns in bypass, the hint cut short', BYPASS_2_1_278, 'bypassPermissions', 'Bypass', 'Zap']
  ])('Claude Code %s', (_build, screen, mode, label, icon) => {
    const seen = observed(screen)
    expect(seen.permissionMode).toBe(mode)
    expect(modeChipSpec({ agent: 'claude', ...seen })).toEqual({ label, icon })
  })

  it('draws Plan as a scroll (its footer row is inferred, not captured, so the mode is given)', () => {
    expect(modeChipSpec({ agent: 'claude', agentMode: null, permissionMode: 'plan' })).toEqual({
      label: 'Plan',
      icon: 'ScrollText'
    })
  })

  it('draws no chip for a bare default: the HUD says it where its footer showed no mode row', () => {
    // `default` is the observation's fill for "a footer, and no mode row on it". It is what the
    // mode sheet and the + sheet read as Manual, but it also stands for a mode row that was out of
    // the footer's reach, so the chip, which names only what a footer stated, will not draw it.
    // A footer that says "manual mode on" (2.1.270, 2.1.276) is `manual` and does draw.
    expect(modeChipSpec({ agent: 'claude', agentMode: null, permissionMode: 'default' })).toBeNull()
  })

  it('draws no Manual chip over a badge screen whose auto-mode row is out of the footer’s reach', () => {
    // Claude Code 2.1.282's ask screen (a captured badge, `[Opus 5.5 xhigh | …]`), then five rows of
    // agents from the 2.1.295 capture under it, as the 2026-10-09 review spliced them
    // (claude-status-line-band-without-turn-row.test.ts): the footer's six rows no longer reach the
    // `⏵⏵ auto mode on` row. The badge path still returns `permissionMode: 'default'` for it, which
    // this chip used to draw as Manual over a session in Auto.
    const ask = readCapture('claude-screen-ask-multi-select-2.1.282.txt')
    while (ask.length > 0 && ask.at(-1)!.trim() === '') {
      ask.pop()
    }
    const finished = readCapture('claude-usage-band-fullscreen-126-agent-finished-2.1.295.txt')
    const main = finished.find((row) => row.startsWith('  ⏺ main'))!
    const agent = finished.findLast((row) => row.startsWith('  ◯ general-purpose'))!
    const spliced = [...ask, main, agent, agent, agent, agent, agent]

    const reachable = parseTerminalHudObservation(ask)
    expect(reachable?.permissionModeSeen).toBe('auto')
    const seen = observed(spliced)
    // The premise: the parser says `default`, though the footer stated nothing.
    expect(parseTerminalHudObservation(spliced)?.permissionModeSeen ?? null).toBeNull()
    expect(seen.permissionMode).toBe('default')
    expect(modeChipSpec({ agent: 'claude', ...seen })).toBeNull()
  })

  it('is drawn on an OpenClaude tab, which paints Claude Code’s footer', () => {
    expect(modeChipSpec({ agent: 'openclaude', agentMode: null, permissionMode: 'auto' })).not.toBeNull()
  })

  it.each<[string, string[]]>([
    ['a shell prompt, the agent gone (tmux, 2026-10-02)', ['hi', SHELL_PROMPTS.zsh]],
    ['Claude’s box with only a shell prompt under it (tmux, 2026-10-02)', claudeBoxThenShell(SHELL_PROMPTS.bash)]
  ])('draws no chip over %s: no footer stated a mode', (_name, screen) => {
    const seen = observed(screen)
    expect(seen).toEqual({ permissionMode: null, agentMode: null })
    expect(modeChipSpec({ agent: 'claude', ...seen })).toBeNull()
  })

  it('draws no chip when the chat has read no screen at all', () => {
    expect(modeChipSpec({ agent: 'claude', agentMode: null, permissionMode: null })).toBeNull()
    expect(modeChipSpec({ agent: 'claude', agentMode: undefined, permissionMode: undefined })).toBeNull()
  })

  it.each<[string, string[]]>([
    ['0.153.4 in Plan mode (live capture, 2026-09-09)', CODEX_PLAN_FOOTER],
    ['0.158.0 idle after a turn (capture)', IDLE_AFTER_TURN_0158]
  ])('draws no chip on a Codex tab, whose footer says %s', (_name, screen) => {
    const seen = observed(screen)
    expect(seen.permissionMode).toBe('default')
    expect(seen.agentMode).not.toBeNull()
    expect(modeChipSpec({ agent: 'codex', ...seen })).toBeNull()
    // Each rule alone rules a Codex tab out, with a Claude-shaped mode on the table: the tab's
    // agent, and the tab's own Plan/Default pair even where the agent is not known to be Codex.
    expect(modeChipSpec({ agent: 'codex', agentMode: null, permissionMode: 'auto' })).toBeNull()
    expect(modeChipSpec({ agent: 'claude', agentMode: seen.agentMode, permissionMode: 'auto' })).toBeNull()
  })

  it('draws no chip on a tab whose agent is not Claude, or not known', () => {
    for (const agent of ['codex', 'grok', 'omp', 'gemini', null, undefined]) {
      expect(modeChipSpec({ agent, agentMode: null, permissionMode: 'auto' }), String(agent)).toBeNull()
    }
  })
})

type ChipProps = ComponentProps<typeof MobileNativeChatModeChip>
let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  sheet.latest = null
})

function flat(style: unknown, pressed = false): Record<string, unknown> {
  if (typeof style === 'function') {
    return flat((style as (state: { pressed: boolean }) => unknown)({ pressed }), pressed)
  }
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.map((entry) => flat(entry, pressed)))
  }
  return (style ?? {}) as Record<string, unknown>
}

function renderChip(scheme: 'light' | 'dark', props: Partial<ChipProps> = {}): void {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatModeChip
          agent="claude"
          agentMode={null}
          permissionMode="acceptEdits"
          onPress={() => {}}
          {...props}
        />
      </ThemeProvider>
    )
  })
}

const chip = (): ReactTestInstance =>
  renderer!.root.find((node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === 'Change mode')

describe.each<['light' | 'dark', ThemeColors]>([
  ['light', lightColors],
  ['dark', darkColors]
])('the mode chip’s look in %s, from the theme', (scheme, colors) => {
  it('is a 36 dp circle of the control fill, 16 x 4 dp padded, its icon and label 4 dp apart', () => {
    renderChip(scheme)
    const style = flat(chip().props.style)
    expect(style).toMatchObject({
      minHeight: 36,
      paddingHorizontal: 16,
      paddingVertical: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.composerControl,
      opacity: 1
    })
    // A circle: corners at least half the 36 dp, whatever the chip's width.
    expect(Number(style.borderRadius)).toBeGreaterThanOrEqual(18)
  })

  it('presses one step darker, as the other composer buttons do', () => {
    renderChip(scheme)
    expect(flat(chip().props.style, true).backgroundColor).toBe(colors.composerControlPressed)
  })

  it('draws a 20 dp icon and a 13 regular one-line label in the primary tone', () => {
    renderChip(scheme)
    const icon = renderer!.root.find((node) => (node.type as unknown) === 'Code')
    expect(icon.props).toMatchObject({ size: 20, color: colors.composerPillText })
    const label = renderer!.root.find((node) => (node.type as unknown) === 'Text')
    expect(label.props.children).toBe('Accept edits')
    expect(label.props.numberOfLines).toBe(1)
    expect(flat(label.props.style)).toMatchObject({ fontSize: 13, lineHeight: 18, color: colors.composerPillText })
  })

  it('goes to 40% and takes no touch while disabled', () => {
    renderChip(scheme, { disabled: true })
    expect(flat(chip().props.style).opacity).toBe(0.4)
    expect(chip().props.disabled).toBe(true)
    expect(chip().props.accessibilityState).toMatchObject({ disabled: true })
  })

  it('stays at 40%, still naming the mode, when it has nothing to open', () => {
    renderChip(scheme, { onPress: undefined })
    expect(flat(chip().props.style).opacity).toBe(0.4)
    expect(chip().props.disabled).toBe(true)
    expect(renderer!.root.find((node) => (node.type as unknown) === 'Text').props.children).toBe('Accept edits')
  })

  it('is read as "Change mode", a button, with the mode as its value', () => {
    renderChip(scheme)
    expect(chip().props.accessibilityRole).toBe('button')
    expect(chip().props.accessibilityValue).toEqual({ text: 'Accept edits' })
  })

  it('reaches 48 dp of touch from its 36 dp, all round', () => {
    renderChip(scheme)
    expect(chip().props.hitSlop).toBe(6)
  })

  it('opens whatever it is given on a press', () => {
    const onPress = vi.fn()
    renderChip(scheme, { onPress })
    act(() => (chip().props.onPress as () => void)())
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('can shrink with its label ellipsizing, so it never pushes the mic and Send off the row', () => {
    renderChip(scheme)
    expect(flat(chip().props.style)).toMatchObject({ flexShrink: 1, minWidth: 0 })
    expect(renderer!.root.find((node) => (node.type as unknown) === 'Text').props.ellipsizeMode).toBe('tail')
  })

  it.each<[TerminalPermissionMode, string]>([
    ['manual', 'Hand'],
    ['acceptEdits', 'Code'],
    ['plan', 'ScrollText'],
    ['auto', 'Zap'],
    ['bypassPermissions', 'Zap']
  ])('draws %s with the %s icon', (permissionMode, name) => {
    renderChip(scheme, { permissionMode })
    expect(renderer!.root.findAll((node) => (node.type as unknown) === name)).toHaveLength(1)
  })

  it('draws nothing when the screen stated no mode', () => {
    renderChip(scheme, { permissionMode: null })
    expect(renderer!.toJSON()).toBeNull()
  })

  it('draws nothing on a Codex tab', () => {
    renderChip(scheme, { agent: 'codex', agentMode: 'plan', permissionMode: 'auto' })
    expect(renderer!.toJSON()).toBeNull()
  })
})

type ComposerProps = ComponentProps<typeof MobileNativeChatComposer>

function renderComposer(scheme: 'light' | 'dark', props: Partial<ComposerProps>): void {
  act(() => {
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        {createElement(MobileNativeChatComposer, {
          value: '',
          onChangeText: () => {},
          onSend: async () => true,
          sendSurfaceId: 'tab-a',
          getSendCompletionGeneration: () => 0,
          getComposerEditGeneration: () => 0,
          onAttachImage: () => {},
          onAttachFile: () => {},
          onMicPress: () => {},
          ...props
        } as ComposerProps)}
      </ThemeProvider>,
      { createNodeMock: () => ({ focus: () => {}, blur: () => {}, isFocused: () => true }) }
    )
  })
}

const rowButtons = (): string[] =>
  renderer!.root
    .find((node) => node.props.testID === 'native-chat-composer-actions')
    .findAll((node) => (node.type as unknown) === 'Pressable')
    .map((node) => String(node.props.accessibilityLabel))

describe.each<['light' | 'dark', ThemeColors]>([
  ['light', lightColors],
  ['dark', darkColors]
])('the mode chip in the composer, %s', (scheme, colors) => {
  it('sits right after the + in the leading group, before the mic and Send', () => {
    renderComposer(scheme, { agent: 'claude', ...observed(AUTO_2_1_281), onSelectPermissionMode: () => {} })
    const buttons = rowButtons()
    expect(buttons.indexOf('Change mode')).toBe(buttons.indexOf('Add to chat') + 1)
    expect(buttons.indexOf('Change mode')).toBeLessThan(buttons.indexOf('Dictate'))
    expect(buttons.indexOf('Change mode')).toBeLessThan(buttons.indexOf('Send message'))
    expect(flat(chip().props.style).backgroundColor).toBe(colors.composerControl)
  })

  it('opens the Select mode sheet on a tap, with the mode the screen stated checked', () => {
    renderComposer(scheme, { agent: 'claude', ...observed(ACCEPT_EDITS_2026_09_18), onSelectPermissionMode: () => {} })
    expect(sheet.latest).toMatchObject({ visible: false, title: 'Select mode' })
    act(() => (chip().props.onPress as () => void)())
    expect(sheet.latest).toMatchObject({ visible: true, title: 'Select mode' })
    expect(sheet.latest!.actions.filter((action) => action.selected).map((action) => action.label)).toEqual([
      'Accept edits'
    ])
  })

  it('is drawn disabled when the host gave no way to change the mode, not hidden', () => {
    renderComposer(scheme, { agent: 'claude', ...observed(AUTO_2_1_281) })
    expect(chip().props.disabled).toBe(true)
    expect(flat(chip().props.style).opacity).toBe(0.4)
  })

  it('is disabled while the composer is locked, as the + and Send are', () => {
    renderComposer(scheme, { agent: 'claude', ...observed(AUTO_2_1_281), onSelectPermissionMode: () => {}, disabled: true })
    expect(chip().props.disabled).toBe(true)
  })

  it('is not drawn when no screen was read', () => {
    renderComposer(scheme, { agent: 'claude', ...observed(['hi', SHELL_PROMPTS.zsh]), onSelectPermissionMode: () => {} })
    expect(rowButtons()).not.toContain('Change mode')
  })

  it.each<[string, string[]]>([
    ['Plan mode', CODEX_PLAN_FOOTER],
    ['idle', IDLE_AFTER_TURN_0158]
  ])('is not drawn on a Codex tab in %s, which keeps its own mode row in the + sheet', (_name, screen) => {
    renderComposer(scheme, { agent: 'codex', ...observed(screen), onSelectAgentMode: () => {} })
    expect(rowButtons()).not.toContain('Change mode')
  })

  it('is not drawn on a Codex tab even if a Claude-shaped mode reached it', () => {
    renderComposer(scheme, {
      agent: 'codex',
      permissionMode: 'auto',
      agentMode: 'plan',
      onSelectPermissionMode: () => {},
      onSelectAgentMode: () => {}
    })
    expect(rowButtons()).not.toContain('Change mode')
  })
})
