import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { ToolDetailBody, ToolDetailHeader } from './MobileNativeChatToolDetailSheet'

// The Claude app's tool sheet, 2026-10-10 screenshots of a Bash call: "Bash"
// in bold over "Completed", then "Description", "Command" and "Output", each a
// small muted label over a box darker than the sheet, the command and output
// in the code face and never wrapped.

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

const BASH: NativeChatToolPair = {
  call: {
    type: 'tool-call',
    name: 'Bash',
    input: {
      command: 'cat /tmp/gate.log && echo "done"',
      description: 'Read the gate and timing result'
    }
  },
  result: { type: 'tool-result', output: 'PASS 412 tests\nDuration 38.2s\n' }
}

function renderTree(children: ReactNode, scheme: 'light' | 'dark' = 'light'): ReactTestRenderer {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(<ThemeProvider initialPreference={scheme}>{children}</ThemeProvider>)
  })
  return renderer
}

/** Every string under a node, nested spans included, in order. */
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
const sections = (renderer: ReactTestRenderer) => renderer.root.findAll((n) => n.props.testID === 'tool-detail-section' && String(n.type) === 'View')
const labels = (renderer: ReactTestRenderer) =>
  hostTexts(renderer)
    .filter((n) => n.props.testID === 'tool-detail-section-label')
    .map((n) => textOf(n))
const boxOf = (section: ReactTestInstance) => section.find((n) => n.props.testID === 'tool-detail-box' && String(n.type) === 'View')

describe('the tool detail sheet, laid out as the Claude app lays it out', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('titles a Bash call "Bash" in bold at the title size, over "Completed" (%s)', (scheme, colors) => {
    renderer = renderTree(createElement(ToolDetailHeader, { pair: BASH }), scheme)
    const title = hostTexts(renderer).find((n) => n.props.testID === 'tool-detail-title')!
    expect(textOf(title)).toBe('Bash')
    expect(flat(title).fontSize).toBe(22)
    expect(String(flat(title).fontFamily)).toMatch(/Bold/i)
    expect(flat(title).color).toBe(colors.text)
    expect(title.props.accessibilityRole).toBe('header')
    expect(textOf(hostTexts(renderer).find((n) => n.props.testID === 'tool-detail-status')!)).toBe('Completed')
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('shows Description, Command and Output in boxes darker than the sheet (%s)', (scheme, colors) => {
    renderer = renderTree(createElement(ToolDetailBody, { pair: BASH }), scheme)
    expect(labels(renderer)).toEqual(['Description', 'Command', 'Output'])
    const [description, command, output] = sections(renderer)
    expect(textOf(boxOf(description!))).toBe('Read the gate and timing result')
    expect(textOf(boxOf(command!))).toBe('cat /tmp/gate.log && echo "done"')
    expect(textOf(boxOf(output!))).toBe('PASS 412 tests\nDuration 38.2s\n')
    for (const section of [description!, command!, output!]) {
      // bgSunken is the darker surface under bgPanel, the sheet's own, in both schemes.
      expect(flat(boxOf(section)).backgroundColor).toBe(colors.bgSunken)
      expect(flat(boxOf(section)).borderRadius).toBe(6)
    }
    expect(colors.bgSunken).not.toBe(colors.bgPanel)
    // The labels are small and muted, and TalkBack can step through them as headings.
    for (const label of hostTexts(renderer).filter((n) => n.props.testID === 'tool-detail-section-label')) {
      expect(flat(label).color).toBe(colors.textMuted)
      expect(label.props.accessibilityRole).toBe('header')
    }
  })

  it.each(['light', 'dark'] as const)('tints the command and never wraps it or the output (%s)', (scheme) => {
    renderer = renderTree(createElement(ToolDetailBody, { pair: BASH }), scheme)
    const [, command, output] = sections(renderer)
    for (const section of [command!, output!]) {
      const scroll = section.find((n) => n.type === ('ScrollView' as never))
      expect(scroll.props.horizontal).toBe(true)
    }
    // The command is drawn in coloured spans of the code face: `cat` is not the
    // colour of the plain text around it, nor the string literal.
    const spans = boxOf(command!)
      .findAllByType('Text' as never)
      .filter((n) => typeof n.props.children === 'string')
    expect(spans.length).toBeGreaterThan(1)
    expect(new Set(spans.map((n) => flat(n).color)).size).toBeGreaterThan(1)
    for (const span of spans) {
      expect(String(flat(span).fontFamily)).toMatch(/Mono/i)
    }
  })

  it('says Failed in the danger tone and draws the error output in it', () => {
    const failed: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'false' } },
      result: { type: 'tool-result', output: 'exit 1', isError: true }
    }
    renderer = renderTree(createElement(ToolDetailHeader, { pair: failed }), 'dark')
    const status = hostTexts(renderer).find((n) => n.props.testID === 'tool-detail-status')!
    expect(textOf(status)).toBe('Failed')
    expect(flat(status).color).toBe(darkColors.danger)
    act(() => renderer!.unmount())
    renderer = renderTree(createElement(ToolDetailBody, { pair: failed }), 'dark')
    expect(labels(renderer)).toEqual(['Command', 'Output'])
    const output = hostTexts(renderer).find((n) => n.props.testID === 'tool-detail-output')!
    expect(flat(output).color).toBe(darkColors.danger)
  })

  it('says Running and draws no Output for a call with no result yet', () => {
    const running: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'sleep 5', description: 'Wait' }, state: 'running' }
    }
    renderer = renderTree(createElement(ToolDetailHeader, { pair: running }))
    expect(textOf(hostTexts(renderer).find((n) => n.props.testID === 'tool-detail-status')!)).toBe('Running')
    act(() => renderer!.unmount())
    renderer = renderTree(createElement(ToolDetailBody, { pair: running }))
    expect(labels(renderer)).toEqual(['Description', 'Command'])
  })

  it('shows a Read as its File and Output', () => {
    const read: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Read', input: { file_path: '/repo/src/app.ts' } },
      result: { type: 'tool-result', output: '1\texport const a = 1' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: read }))
    expect(labels(renderer)).toEqual(['File', 'Output'])
    expect(textOf(boxOf(sections(renderer)[0]!))).toBe('/repo/src/app.ts')
  })

  it('shows a Grep as its Pattern and Path, and an Agent as its Description and Prompt', () => {
    const grep: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Grep', input: { pattern: 'useTheme\\(', path: 'mobile/src' } },
      result: { type: 'tool-result', output: 'a.tsx' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: grep }))
    expect(labels(renderer)).toEqual(['Pattern', 'Path', 'Output'])
    act(() => renderer!.unmount())
    const agent: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Agent', input: { description: 'Review the diff', prompt: 'Look at **this**' } },
      result: { type: 'tool-result', output: 'Done.' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: agent }))
    expect(labels(renderer)).toEqual(['Description', 'Prompt', 'Output'])
    expect(renderer.root.findAllByType('MobileMarkdown' as never).map((n) => n.props.content)).toEqual(['Look at **this**'])
  })

  it('shows an MCP call as its Input in indented JSON, titled by server and tool', () => {
    const mcp: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'mcp__claude_ai_Gmail__search_threads', input: { query: 'from:me', limit: 5 } },
      result: { type: 'tool-result', output: '[]' }
    }
    renderer = renderTree(createElement(ToolDetailHeader, { pair: mcp }))
    expect(textOf(hostTexts(renderer).find((n) => n.props.testID === 'tool-detail-title')!)).toBe(
      'Claude ai Gmail / search threads'
    )
    act(() => renderer!.unmount())
    renderer = renderTree(createElement(ToolDetailBody, { pair: mcp }))
    expect(labels(renderer)).toEqual(['Input', 'Output'])
    expect(textOf(boxOf(sections(renderer)[0]!))).toBe(JSON.stringify({ query: 'from:me', limit: 5 }, null, 2))
  })

  it("shows an edit's File and its Changes as the chat's diff card", () => {
    const edit: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Edit', input: { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } },
      result: { type: 'tool-result', output: 'The file /repo/a.ts has been updated.' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: edit }))
    expect(labels(renderer)).toEqual(['File', 'Changes', 'Output'])
    expect(renderer.root.findAllByType('DiffCard' as never)).toHaveLength(1)
  })

  it('leaves out a section with nothing in it rather than drawing it empty', () => {
    const bare: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'true', description: '   ' } },
      result: { type: 'tool-result', output: '' }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: bare }))
    expect(labels(renderer)).toEqual(['Command'])
  })

  // The degenerate sizes: exactly the cap draws whole with no note, one past it
  // says "1 more line".
  it.each([
    [400, null],
    [401, '1 more line'],
    [1500, '1100 more lines']
  ] as const)('draws the first 400 lines of %i and says how many it left out', (count, note) => {
    const output = Array.from({ length: count }, (_, i) => `${i}`).join('\n')
    const long: NativeChatToolPair = {
      call: { type: 'tool-call', name: 'Bash', input: { command: 'seq 0 2000' } },
      result: { type: 'tool-result', output }
    }
    renderer = renderTree(createElement(ToolDetailBody, { pair: long }))
    const shown = textOf(hostTexts(renderer).find((n) => n.props.testID === 'tool-detail-output')!)
    expect(shown.split('\n')).toHaveLength(400)
    const more = hostTexts(renderer).filter((n) => n.props.testID === 'tool-detail-output-more')
    expect(more.map((n) => textOf(n))).toEqual(note ? [note] : [])
    for (const node of more) {
      expect(flat(node).color).toBe(lightColors.textMuted)
    }
  })
})

// Review of 53e222ee1: the curated sections dropped inputs the old name/value
// rows showed, a NotebookEdit kept only its path, and an argv lost its quoting.
describe('the tool sheet shows everything the call carried', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })
  const body = (pair: NativeChatToolPair) => {
    renderer = renderTree(createElement(ToolDetailBody, { pair }))
    return renderer
  }

  it("keeps a Read's offset and limit, and a Bash call's timeout, under Options", () => {
    const tree = body({
      call: { type: 'tool-call', name: 'Read', input: { file_path: '/a.ts', offset: 10, limit: 40 } },
      result: { type: 'tool-result', output: 'x' }
    })
    expect(labels(tree)).toEqual(['File', 'Options', 'Output'])
    expect(textOf(boxOf(sections(tree)[1]!))).toBe(JSON.stringify({ offset: 10, limit: 40 }, null, 2))
    act(() => renderer!.unmount())
    const bash = body({
      call: { type: 'tool-call', name: 'Bash', input: { command: 'ls', description: 'List', timeout: 60000 } }
    })
    expect(labels(bash)).toEqual(['Description', 'Command', 'Options'])
  })

  it("shows a NotebookEdit's whole input, not only its path", () => {
    const tree = body({
      call: {
        type: 'tool-call',
        name: 'NotebookEdit',
        input: { notebook_path: '/n.ipynb', cell_id: 'c1', new_source: 'print(1)' }
      },
      result: { type: 'tool-result', output: 'ok' }
    })
    expect(labels(tree)).toEqual(['Input', 'Output'])
    expect(textOf(boxOf(sections(tree)[0]!))).toContain('print(1)')
  })

  it('prints an array input as JSON, not joined by commas', () => {
    const tree = body({ call: { type: 'tool-call', name: 'CustomTool', input: [1, { a: 2 }] } })
    expect(textOf(boxOf(sections(tree)[0]!))).toBe(JSON.stringify([1, { a: 2 }], null, 2))
  })

  it("keeps an argv's argument boundaries, and a Codex read's command beside its path", () => {
    const tree = body({
      call: { type: 'tool-call', name: 'exec_command', input: { cmd: ['bash', '-lc', "echo 'a b' && ls"] } }
    })
    expect(textOf(boxOf(sections(tree)[0]!))).toBe(`bash -lc 'echo '"'"'a b'"'"' && ls'`)
    act(() => renderer!.unmount())
    const read = body({ call: { type: 'tool-call', name: 'read', input: { cmd: 'sed -n 1,5p a.ts', path: 'a.ts' } } })
    expect(labels(read)[0]).toBe('Command')
  })

  it('counts the line the character cap cut at a newline as hidden', () => {
    // 3999 characters then a newline: the cap keeps the newline, and the line
    // after it is not shown at all.
    const output = `${'y'.repeat(3999)}\n${'z'.repeat(10)}`
    const tree = body({
      call: { type: 'tool-call', name: 'Bash', input: { command: 'x' } },
      result: { type: 'tool-result', output }
    })
    const more = hostTexts(tree).filter((n) => n.props.testID === 'tool-detail-output-more')
    expect(more.map((n) => textOf(n))).toEqual(['1 more line'])
  })
})
