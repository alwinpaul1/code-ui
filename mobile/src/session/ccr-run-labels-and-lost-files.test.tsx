import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { CCR_HELD_UNDRAWN_EVENTS, CcrEventStore } from './ccr-link-store'
import { decodeCcrEvents } from './ccr-transcript-decode'
import { ccrEvent, filesMissing, prompt, toolCalls, toolResults, toolUseSummary } from './fixtures/ccr-refusal-suggestion-events-2.1.300'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { takeUserUploads } from './mobile-native-chat-file-mentions'
import { MobileNativeChatUploadCardRow } from './MobileNativeChatFileCard'
import { ToolRun } from './MobileNativeChatToolRun'

// Two events Claude Code 2.1.300 emits that draw no row of their own but change rows already drawn,
// as the Claude app 1.261013.20's reducer applies them (t5v.java:1136-1173 and 2506-2541). Neither
// was captured live: the events are built from 2.1.300's SDK schemas
// (fixtures/ccr-refusal-suggestion-events-2.1.300.ts).

vi.mock('react-native', () => ({
  Animated: {
    View: 'View',
    Text: 'Text',
    Value: class {
      constructor(private value: number) {}
      setValue(next: number): void {
        this.value = next
      }
    },
    loop: (animation: unknown) => animation,
    sequence: () => ({ start: vi.fn(), stop: vi.fn() }),
    timing: () => ({ start: vi.fn(), stop: vi.fn() })
  },
  Image: 'Image',
  Platform: { OS: 'android', Version: 34 },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (typeof name === 'string' ? name : undefined), has: () => true }))
vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: 'MobileNativeChatToolDetailSheet' }))
vi.mock('../ui/use-reduced-motion', () => ({ useReducedMotion: () => true }))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function render(node: React.ReactNode, scheme: 'light' | 'dark' = 'light'): ReactTestInstance {
  act(() => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{node}</ThemeProvider>)
  })
  return renderer!.root
}

function Run({ blocks }: { blocks: NativeChatBlock[] }) {
  return createElement(ToolRun, { blocks, defaultExpanded: false, activeCall: null, styles: useChatMessageStyles() })
}

const words = (node: ReactTestInstance): string => node.children.map((child) => (typeof child === 'string' ? child : words(child))).join('')
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...([] as unknown[]).concat(style).flat(Infinity).filter(Boolean))

const CALLS = toolCalls('a-run', [
  { id: 'toolu_a', name: 'Bash', input: { command: 'pnpm test' } },
  { id: 'toolu_b', name: 'Bash', input: { command: 'git diff' } }
])
const RESULTS = toolResults('u-results', ['toolu_a', 'toolu_b'])

/** The run's blocks as the chat folds them: the calls, then their results. */
function runBlocks(...extra: Parameters<typeof decodeCcrEvents>[0]): NativeChatBlock[] {
  return decodeCcrEvents([CALLS, RESULTS, ...extra], new WeakMap()).flatMap((row) => row.blocks)
}

function sentence(blocks: NativeChatBlock[], scheme: 'light' | 'dark' = 'light'): ReactTestInstance {
  return render(<Run blocks={blocks} />, scheme).find((node) => node.props.testID === 'tool-run-sentence' && typeof node.type === 'string')
}

describe('a run Claude Code summarised (tool_use_summary)', () => {
  it('reads "Ran 2 commands" with no summary', () => {
    expect(words(sentence(runBlocks()))).toBe('Ran 2 commands')
  })

  it.each(['light', 'dark'] as const)('is named by the summary, its trailing punctuation off, in the sentence’s own ink (%s)', (scheme) => {
    const plain = flat(sentence(runBlocks(), scheme).props.style).color
    const labelled = sentence(runBlocks(toolUseSummary('Ran the tests and checked the diff.  ', ['toolu_a', 'toolu_b'])), scheme)
    expect(words(labelled)).toBe('Ran the tests and checked the diff')
    expect(flat(labelled.props.style).color).toBe(plain)
  })

  it('takes its ink from the theme, not a fixed colour', () => {
    const summarised = runBlocks(toolUseSummary('Ran the tests', ['toolu_a']))
    expect(flat(sentence(summarised, 'light').props.style).color).not.toBe(flat(sentence(summarised, 'dark').props.style).color)
  })

  it('takes the first id that names a call it drew, past ones it does not know', () => {
    expect(words(sentence(runBlocks(toolUseSummary('Checked the diff', ['toolu_unknown', 'toolu_b']))))).toBe('Checked the diff')
  })

  it('a later summary replaces an earlier one, and an empty one clears the label', () => {
    expect(words(sentence(runBlocks(toolUseSummary('First', ['toolu_a']), toolUseSummary('Second!?', ['toolu_b']))))).toBe('Second')
    expect(words(sentence(runBlocks(toolUseSummary('First', ['toolu_a']), toolUseSummary('  ', ['toolu_b']))))).toBe('Ran 2 commands')
  })

  it('a summary naming no call drawn, no ids, or ids that are not a list, changes nothing', () => {
    for (const ids of [['toolu_elsewhere'], [], 'toolu_a', null]) {
      expect(words(sentence(runBlocks(toolUseSummary('Nope', ids))))).toBe('Ran 2 commands')
    }
  })

  it('still counts a failed call beside the summary, which states none', () => {
    const failed = ccrEvent({ type: 'user', uuid: 'u-failed', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'exit 1', is_error: true }] } })
    const blocks = decodeCcrEvents([CALLS, failed, toolUseSummary('Ran the tests', ['toolu_a'])], new WeakMap()).flatMap((row) => row.blocks)
    const root = render(<Run blocks={blocks} />)
    expect(words(root.find((node) => node.props.testID === 'tool-run-sentence' && typeof node.type === 'string'))).toBe('Ran the tests')
    expect(root.findAll((node) => node.props.testID === 'tool-run-failed-count' && typeof node.type === 'string')).toHaveLength(1)
  })
})

const FILES = [
  { file_uuid: 'file_01A', file_name: 'notes.pdf', is_image: false },
  { file_uuid: 'file_01B', file_name: 'plan.md', is_image: false },
  { file_uuid: 'file_01C', file_name: 'data.csv', is_image: false }
]
const SENT = prompt('u-sent', 'Read these', { file_attachments: FILES })

function uploadsOf(rows: NativeChatMessage[]) {
  return takeUserUploads(rows.find((row) => row.id === 'u-sent')!.blocks).cards
}

describe('files that did not reach Claude (file_attachments_missing)', () => {
  it.each(['light', 'dark'] as const)('says "2 files didn’t reach Claude" under the prompt’s cards, in the error ink, and each lost card says so (%s)', (scheme) => {
    const rows = decodeCcrEvents([SENT, filesMissing('u-sent', [{ file_uuid: 'file_01A', reason: 'upload_failed' }, { file_uuid: 'file_01C', reason: 'upload_failed' }])], new WeakMap())
    const root = render(<MobileNativeChatUploadCardRow cards={uploadsOf(rows)} />, scheme)
    const caption = root.find((node) => node.props.testID === 'upload-not-arrived' && typeof node.type === 'string')
    expect(words(caption)).toBe('2 files didn’t reach Claude')
    expect(flat(caption.props.style).color).toBe((scheme === 'light' ? lightColors : darkColors).danger)
    const labels = root.findAll((node) => String(node.type) === 'Pressable' && typeof node.props.accessibilityLabel === 'string').map((node) => node.props.accessibilityLabel)
    expect(labels).toEqual(['Attached file notes, Didn’t reach Claude', 'Attached file plan', 'Attached file data, Didn’t reach Claude'])
  })

  it('says "1 file" for one, and arrives before its prompt as well as after it', () => {
    const rows = decodeCcrEvents([filesMissing('u-sent', [{ file_uuid: 'file_01B', reason: 'x' }]), SENT], new WeakMap())
    const root = render(<MobileNativeChatUploadCardRow cards={uploadsOf(rows)} />)
    expect(words(root.find((node) => node.props.testID === 'upload-not-arrived' && typeof node.type === 'string'))).toBe('1 file didn’t reach Claude')
  })

  it('the newest report replaces the last', () => {
    const rows = decodeCcrEvents([SENT, filesMissing('u-sent', [{ file_uuid: 'file_01A' }, { file_uuid: 'file_01B' }]), filesMissing('u-sent', [{ file_uuid: 'file_01C' }])], new WeakMap())
    expect(uploadsOf(rows).map((card) => card.attachment?.missing ?? false)).toEqual([false, false, true])
  })

  it('draws no line for a report with no uuid, an empty or malformed list, another prompt, a subagent’s, or a file not in the prompt', () => {
    for (const report of [
      filesMissing(null, [{ file_uuid: 'file_01A' }]),
      filesMissing('u-sent', []),
      filesMissing('u-sent', 'file_01A'),
      filesMissing('u-sent', [{ uuid: 'file_01A' }]),
      filesMissing('u-other', [{ file_uuid: 'file_01A' }]),
      filesMissing('u-sent', [{ file_uuid: 'file_01A' }], { parent_tool_use_id: 'toolu_agent' }),
      filesMissing('u-sent', [{ file_uuid: 'file_99' }])
    ]) {
      const root = render(<MobileNativeChatUploadCardRow cards={uploadsOf(decodeCcrEvents([SENT, report], new WeakMap()))} />)
      expect(root.findAll((node) => node.props.testID === 'upload-not-arrived')).toHaveLength(0)
    }
  })
})

describe('a session link holds what changes a row', () => {
  it('keeps a summary and a lost-files report past the undrawn cap, and in the kept copy', () => {
    const store = new CcrEventStore(() => null)
    const summary = toolUseSummary('Ran the tests', ['toolu_a'])
    const lost = filesMissing('u-sent', [{ file_uuid: 'file_01A' }])
    store.add([SENT, CALLS, summary, lost])
    store.add(Array.from({ length: CCR_HELD_UNDRAWN_EVENTS + 5 }, (_row, index) => ccrEvent({ type: 'system', subtype: 'status', uuid: `status-${index}` })))
    expect(store.ordered).toContain(summary)
    expect(store.ordered).toContain(lost)
    expect(store.drawing()).toEqual([CALLS, SENT, summary, lost])
  })

  // Review 2026-10-15: a subagent's own summaries and lost-files reports annotate nothing in the
  // lead's chat, yet the keep rule held every one of them past the undrawn cap, for good.
  it('a flood of a subagent’s summaries and lost-files reports stays within the undrawn cap', () => {
    const store = new CcrEventStore(() => null)
    const flood = Array.from({ length: CCR_HELD_UNDRAWN_EVENTS * 2 }, (_row, index) =>
      index % 2 === 0
        ? ccrEvent({ type: 'tool_use_summary', summary: `Step ${index}`, preceding_tool_use_ids: [`toolu_sub_${index}`], parent_tool_use_id: 'toolu_agent' })
        : filesMissing(`u-sub-${index}`, [{ file_uuid: 'file_01A' }], { parent_tool_use_id: 'toolu_agent' })
    )
    store.add([SENT, CALLS, ...flood])
    expect(store.ordered).toHaveLength(2 + CCR_HELD_UNDRAWN_EVENTS)
    expect(store.drawing()).toEqual([CALLS, SENT])
  })
})
