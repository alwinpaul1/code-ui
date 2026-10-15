import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { MAX_TOOL_DETAIL_LENGTH } from '../../../src/shared/native-chat-tool-summary'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { SEND_MESSAGE_CLAUDE_CODE_2_1_281 } from './fixtures/claude-send-message-2.1.281'
import { ToolDetailBody, ToolDetailHeader } from './MobileNativeChatToolDetailSheet'

// A tool the phone has no view of its own for, opened from its row (0.9.150
// screenshot: Claude Code's SendMessage, "Messaged @aecc2026935a…"). The sheet
// listed raw field names over inset boxes, a debug dump. The Claude app's own
// fallback for a tool it has no layout for (Claude 1.261009.20, y030.e -> y030.h):
//   "Inputs" (13 sp, weight 550, muted, 8 dp under), then per input the name at
//   13 sp in the secondary colour, 2 dp above its value at 15 sp in the primary
//   colour, 8 dp under each pair, no box (ne9 case 20, xv1 case 14);
//   then "Result" (13 sp, 550) over the text rendered as Markdown, or "Error"
//   in the error colour over the text (y030.p, wrj default case).
// Status reads "In progress" while running (ccr_tool_status_in_progress).

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('../components/MobileMarkdown', async () => {
  const { createElement: h } = await import('react')
  return { MobileMarkdown: (props: { content: string }) => h('MobileMarkdown', { content: props.content }) }
})
vi.mock('../components/DraggableDetailSheet', () => ({ DraggableDetailSheet: 'DraggableDetailSheet' }))
vi.mock('./MobileNativeChatDiffCard', () => ({ MobileNativeChatDiffCard: 'DiffCard' }))
vi.mock('react-native-gesture-handler', async () => {
  const { createElement: h } = await import('react')
  const builder: unknown = new Proxy({}, { get: (_, key) => (key === 'kind' ? 'native' : () => builder) })
  return {
    Gesture: { Native: () => builder },
    GestureDetector: (props: Record<string, unknown>) => h('GestureDetector', props)
  }
})

function renderTree(children: ReactNode, scheme: 'light' | 'dark' = 'light'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{children}</ThemeProvider>)
  })
  return renderer
}

function textOf(node: ReactTestInstance | string): string {
  if (typeof node === 'string') {
    return node
  }
  return node.children.map((child) => textOf(child as ReactTestInstance | string)).join('')
}

function flat(node: ReactTestInstance): Record<string, unknown> {
  const style = node.props.style
  const entries = (Array.isArray(style) ? style.flat() : [style]) as (Record<string, unknown> | null | undefined)[]
  return Object.assign({}, ...entries.filter(Boolean))
}

const hostTexts = (renderer: ReactTestRenderer) => renderer.root.findAllByType('Text' as never)
const byId = (renderer: ReactTestRenderer, testID: string) => hostTexts(renderer).filter((n) => n.props.testID === testID)
const labels = (renderer: ReactTestRenderer) => byId(renderer, 'tool-detail-section-label').map((n) => textOf(n))
const boxes = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((n) => n.props.testID === 'tool-detail-box' && String(n.type) === 'View')
const markdown = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType('MobileMarkdown' as never).map((n) => n.props.content as string)

const MCP: NativeChatToolPair = {
  call: {
    type: 'tool-call',
    name: 'mcp__claude_ai_Gmail__search_threads',
    input: { query: 'from:alice newer_than:7d', pageSize: 5, filter: { labels: ['INBOX', 'STARRED'], unread: true } }
  },
  result: { type: 'tool-result', output: 'Found 2 threads.' }
}

describe('a tool with no dedicated view opens a detail sheet laid out like the Claude app\'s, not a dump of field names', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('lists a real SendMessage as Inputs, each name over its value with no box, then Result (%s)', (scheme, colors) => {
    renderer = renderTree(createElement(ToolDetailBody, { pair: SEND_MESSAGE_CLAUDE_CODE_2_1_281 }), scheme)
    expect(labels(renderer)).toEqual(['Inputs', 'Result'])
    // Not a debug dump: no inset box anywhere, and no field name set as a section heading.
    expect(boxes(renderer)).toHaveLength(0)
    const names = byId(renderer, 'tool-detail-input-name')
    expect(names.map((n) => textOf(n))).toEqual(['content', 'message', 'recipient', 'summary', 'to', 'type'])
    for (const name of names) {
      expect(flat(name).fontSize).toBe(13)
      expect(flat(name).color).toBe(colors.textSecondary)
    }
    const values = byId(renderer, 'tool-detail-input-value')
    // `content` and `message` are Markdown and are drawn rendered (the user, 2026-09-28); the rest are text.
    expect(values.map((n) => textOf(n))).toEqual([
      'team-lead',
      'Early finding: native Back ordering regression',
      'team-lead',
      'message'
    ])
    for (const value of values) {
      expect(flat(value).fontSize).toBe(15)
      expect(flat(value).color).toBe(colors.text)
    }
    const sent = SEND_MESSAGE_CLAUDE_CODE_2_1_281.call!.input as { content: string; message: string }
    expect(markdown(renderer).slice(0, 2)).toEqual([sent.content, sent.message])
    // The headings are muted at 13 sp, and TalkBack steps through them.
    for (const heading of byId(renderer, 'tool-detail-section-label')) {
      expect(flat(heading).fontSize).toBe(13)
      expect(flat(heading).color).toBe(colors.textMuted)
      expect(heading.props.accessibilityRole).toBe('header')
    }
  })

  it.each(['light', 'dark'] as const)('puts 2 dp between a name and its value and 8 dp under each pair (%s)', (scheme) => {
    renderer = renderTree(createElement(ToolDetailBody, { pair: SEND_MESSAGE_CLAUDE_CODE_2_1_281 }), scheme)
    const rows = renderer.root.findAll((n) => n.props.testID === 'tool-detail-input-row' && String(n.type) === 'View')
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(flat(row).gap).toBe(2)
      expect(flat(row).paddingBottom).toBe(8)
    }
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the result as Markdown under a muted "Result" (%s)', (scheme, colors) => {
    renderer = renderTree(createElement(ToolDetailBody, { pair: SEND_MESSAGE_CLAUDE_CODE_2_1_281 }), scheme)
    expect(markdown(renderer)).toContain(SEND_MESSAGE_CLAUDE_CODE_2_1_281.result!.output)
    const result = byId(renderer, 'tool-detail-section-label')[1]!
    expect(textOf(result)).toBe('Result')
    expect(flat(result).color).toBe(colors.textMuted)
    // No Prettify pill: that belongs to a Bash call's Output.
    expect(renderer.root.findAllByProps({ testID: 'tool-detail-prettify' })).toHaveLength(0)
  })

  it('keeps the title the Claude app gives a SendMessage over "Completed"', () => {
    renderer = renderTree(createElement(ToolDetailHeader, { pair: SEND_MESSAGE_CLAUDE_CODE_2_1_281 }))
    expect(textOf(byId(renderer, 'tool-detail-title')[0]!)).toBe('Messaged @team-lead')
    expect(textOf(byId(renderer, 'tool-detail-status')[0]!)).toBe('Completed')
  })

  it('shows an MCP call as Inputs too, titled by server and tool, a nested value as compact JSON', () => {
    renderer = renderTree(createElement(ToolDetailHeader, { pair: MCP }))
    expect(textOf(byId(renderer, 'tool-detail-title')[0]!)).toBe('Claude ai Gmail / search threads')
    act(() => renderer!.unmount())
    renderer = renderTree(createElement(ToolDetailBody, { pair: MCP }))
    expect(labels(renderer)).toEqual(['Inputs', 'Result'])
    expect(byId(renderer, 'tool-detail-input-name').map((n) => textOf(n))).toEqual(['filter', 'pageSize', 'query'])
    expect(byId(renderer, 'tool-detail-input-value').map((n) => textOf(n))).toEqual([
      '{"labels":["INBOX","STARRED"],"unread":true}',
      '5',
      'from:alice newer_than:7d'
    ])
    expect(boxes(renderer)).toHaveLength(0)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('headlines a failed call "Error" in the danger colour over its text, not Markdown (%s)', (scheme, colors) => {
    const failed: NativeChatToolPair = {
      call: MCP.call,
      result: { type: 'tool-result', output: 'Error: 401 Unauthorized, reconnect Gmail', isError: true }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: failed }), scheme)
    expect(labels(renderer)).toEqual(['Inputs', 'Error'])
    const heading = byId(renderer, 'tool-detail-section-label')[1]!
    expect(flat(heading).color).toBe(colors.danger)
    const text = byId(renderer, 'tool-detail-output')[0]!
    expect(textOf(text)).toBe('Error: 401 Unauthorized, reconnect Gmail')
    expect(flat(text).color).toBe(colors.danger)
    expect(markdown(renderer)).toEqual([])
  })

  it('reads "In progress" and draws no Result for a call with no result yet', () => {
    const running: NativeChatToolPair = { call: { ...SEND_MESSAGE_CLAUDE_CODE_2_1_281.call!, state: 'running' } }
    renderer = renderTree(createElement(ToolDetailHeader, { pair: running }))
    expect(textOf(byId(renderer, 'tool-detail-status')[0]!)).toBe('In progress')
    act(() => renderer!.unmount())
    renderer = renderTree(createElement(ToolDetailBody, { pair: running }))
    expect(labels(renderer)).toEqual(['Inputs'])
  })

  it('draws only the Result for a call with an empty input', () => {
    const noArgs: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'ListMcpResourcesTool', input: {} },
      result: { type: 'tool-result', output: 'No resources.' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: noArgs }))
    expect(labels(renderer)).toEqual(['Result'])
    expect(markdown(renderer)).toEqual(['No resources.'])
  })

  it('draws nothing at all for an empty input that has no result yet', () => {
    const idle: NativeChatToolPair = { call: { type: 'tool-call', name: 'ListMcpResourcesTool', input: {}, state: 'running' } }
    renderer = renderTree(createElement(ToolDetailBody, { pair: idle }))
    expect(labels(renderer)).toEqual([])
  })

  it('draws a result whose call never arrived as a Result alone', () => {
    renderer = renderTree(createElement(ToolDetailBody, { pair: { result: { type: 'tool-result', output: 'late' } } }))
    expect(labels(renderer)).toEqual(['Result'])
  })

  it('stops a 100 KB input value and a 100 KB result at the detail cap, and counts the lines left out', () => {
    const huge: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'CustomTool', input: { payload: 'x'.repeat(100_000) } },
      result: { type: 'tool-result', output: Array.from({ length: 900 }, (_, i) => `row ${i}`).join('\n') }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: huge }))
    const value = textOf(byId(renderer, 'tool-detail-input-value')[0]!)
    expect(value).toHaveLength(MAX_TOOL_DETAIL_LENGTH + 1)
    expect(value.endsWith('…')).toBe(true)
    expect(textOf(byId(renderer, 'tool-detail-output-more')[0]!)).toMatch(/^\d+ more lines$/)
  })

  it('keeps a Bash call on its own Description, Command and Output boxes', () => {
    const bash: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'ls', description: 'List files' } },
      result: { type: 'tool-result', output: 'a.ts\n' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: bash }))
    expect(labels(renderer)).toEqual(['Description', 'Command', 'Output'])
    expect(boxes(renderer)).toHaveLength(3)
  })
})
