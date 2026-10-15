import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import type { CcrEvent } from './ccr-session-api'
import { ccrPromptSuggestion } from './ccr-prompt-suggestion'
import { ClaudeChatLiveContext, type ClaudeChatLive } from './claude-chat-live'
import { ccrEvent, prompt, promptSuggestion, result, toolCalls } from './fixtures/ccr-refusal-suggestion-events-2.1.300'

// The next-prompt suggestion (`prompt_suggestion`) as the Claude app 1.261013.20 offers it in the
// empty composer (k730.e; t5v.java:1221, r1n). Never captured live: the events are built from
// Claude Code 2.1.300's SDK schema (fixtures/ccr-refusal-suggestion-events-2.1.300.ts).

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { dismiss: vi.fn(), isVisible: () => false, addListener: () => ({ remove: () => {} }) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))
vi.mock('react-native-svg', () => ({ default: () => null, Circle: () => null }))
vi.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (typeof name === 'string' ? name : undefined), has: () => true }))
vi.mock('../components/BottomDrawer', () => ({ BottomDrawer: () => null }))

import { MobileNativeChatComposer } from './MobileNativeChatComposer'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function live(events: readonly CcrEvent[] | null): ClaudeChatLive | null {
  return events ? { footer: null, working: false, runningCount: 0, sessionConnection: null, linkLive: true, rateLimit: null, stream: { events, accountId: 'acct', sessionId: 'cse_x', tasks: [] } } : null
}

function composer(chatLive: ClaudeChatLive | null, value: string, onChangeText: (text: string) => void, scheme: 'light' | 'dark') {
  return (
    <ThemeProvider initialPreference={scheme}>
      <ClaudeChatLiveContext.Provider value={chatLive}>
        <MobileNativeChatComposer
          value={value}
          onChangeText={onChangeText}
          onSend={vi.fn().mockResolvedValue(true)}
          sendSurfaceId="tab-a"
          getSendCompletionGeneration={() => 0}
          getComposerEditGeneration={() => 0}
          placeholder="Type / for commands"
        />
      </ClaudeChatLiveContext.Provider>
    </ThemeProvider>
  )
}

async function render(events: readonly CcrEvent[] | null, { value = '', onChangeText = vi.fn(), scheme = 'light' as 'light' | 'dark' } = {}) {
  await act(async () => {
    renderer = create(composer(live(events), value, onChangeText, scheme))
  })
  return { rerender: async (next: string) => act(async () => renderer!.update(composer(live(events), next, onChangeText, scheme))) }
}

const chips = (): ReactTestInstance[] => renderer!.root.findAll((node) => node.props.testID === 'composer-prompt-suggestion' && typeof node.type === 'string')
const input = (): ReactTestInstance => renderer!.root.find((node) => (node.type as unknown) === 'TextInput')
const words = (node: ReactTestInstance): string => node.children.map((child) => (typeof child === 'string' ? child : words(child))).join('')
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

const TURN = [prompt('u-1', 'Fix the parser'), toolCalls('a-1', [{ id: 'toolu_1', name: 'Bash', input: { command: 'pnpm test' } }]), result()]

describe('the composer’s next-prompt suggestion', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('offers the suggestion in the empty field in the hint ink, with an accept pill, in place of the placeholder (%s)', async (scheme, colors) => {
    await render([...TURN, promptSuggestion('Run the tests again')], { scheme })
    const [chip] = chips()
    expect(chip!.props.accessibilityLabel).toBe('Suggested next prompt: Run the tests again. Double tap to fill.')
    const text = chip!.findByType('Text' as never)
    expect(words(text)).toBe('Run the tests again  ')
    expect(flat(text.props.style).color).toBe(colors.composerPlaceholder)
    expect(text.props.numberOfLines).toBe(2)
    expect(chip!.findAll((node) => node.props.testID === 'composer-prompt-suggestion-accept')).not.toHaveLength(0)
    expect(input().props.placeholder).toBe('')
  })

  it('a tap puts the suggestion in the field', async () => {
    const onChangeText = vi.fn()
    await render([...TURN, promptSuggestion('Run the tests again')], { onChangeText })
    act(() => chips()[0]!.props.onPress())
    expect(onChangeText).toHaveBeenCalledWith('Run the tests again')
  })

  it('stays gone once the user typed over it, even when the field is emptied again', async () => {
    const { rerender } = await render([...TURN, promptSuggestion('Run the tests again')])
    await rerender('Something else')
    expect(chips()).toHaveLength(0)
    await rerender('')
    expect(chips()).toHaveLength(0)
    expect(input().props.placeholder).toBe('Type / for commands')
  })

  it('offers nothing on a tab without Anthropic’s stream (a Codex tab, a desktop-read Claude tab)', async () => {
    await render(null)
    expect(chips()).toHaveLength(0)
    expect(input().props.placeholder).toBe('Type / for commands')
  })
})

describe('which suggestion stands', () => {
  it('the newest after the turn, until the next prompt or reply', () => {
    expect(ccrPromptSuggestion([...TURN, promptSuggestion('One'), promptSuggestion('Two')])?.text).toBe('Two')
    expect(ccrPromptSuggestion([...TURN, promptSuggestion('One'), ccrEvent({ type: 'system', subtype: 'status' }), result()])?.text).toBe('One')
    expect(ccrPromptSuggestion([...TURN, promptSuggestion('One'), prompt('u-2', 'Next')])).toBeNull()
    expect(ccrPromptSuggestion([...TURN, promptSuggestion('One'), toolCalls('a-2', [{ id: 'toolu_2', name: 'Read', input: {} }])])).toBeNull()
  })

  it('none for no events, a blank or non-text suggestion, or a subagent’s', () => {
    expect(ccrPromptSuggestion([])).toBeNull()
    expect(ccrPromptSuggestion([...TURN, promptSuggestion('   ')])).toBeNull()
    expect(ccrPromptSuggestion([...TURN, promptSuggestion(42)])).toBeNull()
    expect(ccrPromptSuggestion([...TURN, promptSuggestion('Mine', { parent_tool_use_id: 'toolu_agent' })])).toBeNull()
  })

  it('a subagent’s message after the suggestion leaves it standing', () => {
    const sub = ccrEvent({ type: 'assistant', parent_tool_use_id: 'toolu_agent', message: { role: 'assistant', content: 'working' } })
    expect(ccrPromptSuggestion([...TURN, promptSuggestion('One'), sub])?.text).toBe('One')
  })
})
