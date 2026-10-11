import type { ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatToolPair } from '../../../src/shared/native-chat-tool-fold'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { REAL_READS, readPair } from './fixtures/claude-read-results-2.1.283'
import type { CreatedFileReadOutcome } from './mobile-native-chat-created-file-read'
import { ToolDetailBody } from './MobileNativeChatToolDetailSheet'
import { NativeChatFileReadProvider, type NativeChatFileReader } from './native-chat-file-read-context'

// Parity gap G19: the Claude app's Read sheet (1.261009.20, `y030`) draws the
// file's lines with their numbers, says "Showing N lines (truncated)" when it
// holds only part of the file, and offers "Load full file" (`read_file`). On
// the phone the part comes from Orca's wire (4000 characters) or the call's own
// offset/limit; the whole file comes from `files.read`, worktree files only.
// Fed with real Read results (fixtures/claude-read-results-2.1.283.ts).

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
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
const byTestId = (renderer: ReactTestRenderer, id: string) => renderer.root.findAll((n) => n.props.testID === id && typeof n.type === 'string')
const joined = (renderer: ReactTestRenderer, id: string) =>
  byTestId(renderer, id)
    .filter((n) => String(n.type) === 'Text')
    .map((n) => textOf(n))
    .join('\n')
const gutter = (renderer: ReactTestRenderer) => joined(renderer, 'read-viewer-gutter').split('\n')
const fileLines = (renderer: ReactTestRenderer) => joined(renderer, 'read-viewer-lines').split('\n')
const caption = (renderer: ReactTestRenderer) => joined(renderer, 'read-viewer-caption')
const allText = (renderer: ReactTestRenderer) => hostTexts(renderer).map((n) => textOf(n)).join('\n')

function press(renderer: ReactTestRenderer, id: string): void {
  const target = renderer.root.find((n) => n.props.testID === id && String(n.type) === 'Pressable')
  act(() => {
    ;(target.props.onPress as () => void)()
  })
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function reader(outcome: CreatedFileReadOutcome, connected = true): NativeChatFileReader & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    connected,
    read: (path) => {
      asked.push(path)
      return Promise.resolve(outcome)
    }
  }
}

function sheet(pair: NativeChatToolPair, fileReader: NativeChatFileReader | null = null) {
  return (
    <NativeChatFileReadProvider value={fileReader}>
      <ToolDetailBody pair={pair} />
    </NativeChatFileReadProvider>
  )
}

/** The real file text the wholeTypescript read listed, numbers stripped. */
const WHOLE_FILE = REAL_READS.wholeTypescript.output
  .split('\n')
  .map((line) => line.replace(/^\d+\t/, ''))
  .join('\n')

describe('the Read sheet numbers its lines and can load the whole file', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it("numbers the lines of a read Orca's wire cut, and says it holds only part of the file", () => {
    renderer = renderTree(sheet(readPair(REAL_READS.wholeTypescript)))
    const numbers = gutter(renderer)
    expect(numbers[0]).toBe('1')
    // Whole lines only: the line the 4000-character cut split is not drawn.
    expect(numbers.map(Number)).toEqual(numbers.map((_, index) => index + 1))
    expect(fileLines(renderer).some((line) => /^\d+\t/.test(line))).toBe(false)
    expect(fileLines(renderer)[0]).toBe(WHOLE_FILE.split('\n')[0])
    expect(caption(renderer)).toBe(`Showing ${numbers.length} lines (truncated)`)
    // No raw Output box under the listing.
    expect(byTestId(renderer, 'tool-detail-output')).toHaveLength(0)
  })

  it('starts the numbers at the offset of a ranged read, and calls the range truncated', () => {
    renderer = renderTree(sheet(readPair(REAL_READS.partialYaml)))
    expect(gutter(renderer)).toEqual(Array.from({ length: 15 }, (_, index) => String(84 + index)))
    expect(fileLines(renderer)[1]).toBe('      - name: Resolve release version and version code')
    expect(caption(renderer)).toBe('Showing 15 lines (truncated)')
  })

  it('draws a whole short read with no truncation line and no Load full file', () => {
    renderer = renderTree(sheet(readPair(REAL_READS.shellOutputFile), reader({ kind: 'read', content: '', truncated: false })))
    expect(gutter(renderer)).toHaveLength(15)
    expect(byTestId(renderer, 'read-viewer-caption')).toHaveLength(0)
    expect(byTestId(renderer, 'read-viewer-load')).toHaveLength(0)
  })

  it('loads the whole file through the host and then draws every line of it', async () => {
    const fileReader = reader({ kind: 'read', content: `${WHOLE_FILE}\n`, truncated: false })
    renderer = renderTree(sheet(readPair(REAL_READS.wholeTypescript), fileReader))
    expect(allText(renderer)).toContain('Load full file')
    press(renderer, 'read-viewer-load')
    await settle()
    expect(fileReader.asked).toEqual([REAL_READS.wholeTypescript.input.file_path])
    expect(gutter(renderer)).toHaveLength(REAL_READS.wholeTypescript.file.totalLines)
    expect(fileLines(renderer).at(-1)).toBe(WHOLE_FILE.split('\n').at(-1))
    expect(byTestId(renderer, 'read-viewer-caption')).toHaveLength(0)
    expect(byTestId(renderer, 'read-viewer-load')).toHaveLength(0)
  })

  it("says the host cut a file it sent only the start of, with the host's cap", async () => {
    renderer = renderTree(sheet(readPair(REAL_READS.wholeTypescript), reader({ kind: 'read', content: WHOLE_FILE, truncated: true })))
    press(renderer, 'read-viewer-load')
    await settle()
    expect(caption(renderer)).toBe('Loaded first 512 KB; file is larger')
  })

  it('keeps the part it had and says why when the host refuses the file', async () => {
    renderer = renderTree(
      sheet(readPair(REAL_READS.wholeTypescript), reader({ kind: 'refused', reason: 'outside the workspace' }))
    )
    const before = gutter(renderer)
    press(renderer, 'read-viewer-load')
    await settle()
    expect(joined(renderer, 'read-viewer-load-error')).toBe("Couldn't load file: outside the workspace")
    expect(gutter(renderer)).toEqual(before)
    // A refusal will not change on asking again; a failed read may.
    expect(byTestId(renderer, 'read-viewer-load')).toHaveLength(0)
  })

  it('offers the button again after a read that failed on the way', async () => {
    renderer = renderTree(sheet(readPair(REAL_READS.wholeTypescript), reader({ kind: 'failed', reason: "couldn't read: timeout" })))
    press(renderer, 'read-viewer-load')
    await settle()
    expect(joined(renderer, 'read-viewer-load-error')).toBe("Couldn't load file: couldn't read: timeout")
    expect(byTestId(renderer, 'read-viewer-load').length).toBeGreaterThan(0)
  })

  it('sends nothing while the host is not connected, and says so', () => {
    const fileReader = reader({ kind: 'read', content: WHOLE_FILE, truncated: false }, false)
    renderer = renderTree(sheet(readPair(REAL_READS.wholeTypescript), fileReader))
    press(renderer, 'read-viewer-load')
    expect(fileReader.asked).toEqual([])
    expect(joined(renderer, 'read-viewer-load-error')).toBe('Not connected to session')
  })

  it('has no Load full file where nothing can read the desktop', () => {
    renderer = renderTree(sheet(readPair(REAL_READS.wholeTypescript), null))
    expect(byTestId(renderer, 'read-viewer-load')).toHaveLength(0)
    expect(caption(renderer)).toMatch(/^Showing \d+ lines \(truncated\)$/)
  })

  it('renders a Markdown file on Render, and shows the numbered lines again on Raw', () => {
    renderer = renderTree(sheet(readPair(REAL_READS.partialMarkdown)))
    press(renderer, 'read-viewer-render')
    const markdown = renderer.root.findAll((n) => String(n.type) === 'MobileMarkdown')
    expect(markdown).toHaveLength(1)
    expect(String(markdown[0]!.props.content).split('\n')[0]).toBe(
      '  kept apart from `live=` (`stopRunningTaskIds`, `stopRunningTaskIdsAt` on the'
    )
    expect(byTestId(renderer, 'read-viewer-gutter')).toHaveLength(0)
    press(renderer, 'read-viewer-render')
    expect(gutter(renderer)[0]).toBe('716')
  })

  it('offers no Render on a file that is not Markdown', () => {
    renderer = renderTree(sheet(readPair(REAL_READS.partialYaml)))
    expect(byTestId(renderer, 'read-viewer-render')).toHaveLength(0)
  })

  it.each(['light', 'dark'] as const)('draws the numbers in the muted ink and the lines in the primary ink (%s)', (scheme) => {
    const colors = scheme === 'light' ? lightColors : darkColors
    renderer = renderTree(sheet(readPair(REAL_READS.partialYaml)), scheme)
    const numbers = byTestId(renderer, 'read-viewer-gutter').find((n) => String(n.type) === 'Text')
    const lines = byTestId(renderer, 'read-viewer-lines').find((n) => String(n.type) === 'Text')
    expect(flat(numbers!).color).toBe(colors.textMuted)
    expect(flat(lines!).color).toBe(colors.text)
  })
})

describe('a read that is not a numbered listing keeps the plain Output box', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it("leaves a Codex read, which is a command and its output, as it was", () => {
    renderer = renderTree(
      sheet({
        call: { type: 'tool-call', name: 'read', input: { command: ['sed', '-n', '1,4p', 'src/a.ts'] } },
        result: { type: 'tool-result', output: 'export const a = 1\n' }
      })
    )
    expect(byTestId(renderer, 'read-viewer-gutter')).toHaveLength(0)
    expect(joined(renderer, 'tool-detail-output')).toBe('export const a = 1\n')
  })

  it("leaves Claude Code's notice for an empty file as text", () => {
    const notice = '<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>'
    renderer = renderTree(
      sheet({ call: { type: 'tool-call', name: 'Read', input: { file_path: '/tmp/empty.txt' } }, result: { type: 'tool-result', output: notice } })
    )
    expect(byTestId(renderer, 'read-viewer-gutter')).toHaveLength(0)
    expect(joined(renderer, 'tool-detail-output')).toBe(notice)
  })

  it('draws a one-line file as one numbered line', () => {
    renderer = renderTree(
      sheet({ call: { type: 'tool-call', name: 'Read', input: { file_path: '/tmp/one.txt' } }, result: { type: 'tool-result', output: '1\tonly line' } })
    )
    expect(gutter(renderer)).toEqual(['1'])
    expect(fileLines(renderer)).toEqual(['only line'])
    expect(byTestId(renderer, 'read-viewer-caption')).toHaveLength(0)
  })
})
