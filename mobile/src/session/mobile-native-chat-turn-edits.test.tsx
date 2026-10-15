import { createElement, type ReactNode, type ComponentType } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'

vi.mock('./MobileNativeChatToolDetailSheet', () => ({ MobileNativeChatToolDetailSheet: () => null }))
vi.mock('react-native', async () => {
  const React = await import('react')
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: unknown }) =>
      React.createElement(name, props, children as ReactNode)
  return {
    Animated: {
      View: host('View'),
      Text: host('Text'),
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
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    Text: host('Text'),
    View: host('View'),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    useColorScheme: () => 'light',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 })
  }
})
// The card is off in the app as the user has it (TURN_EDITS_CARD_SHOWN); these tests pin how it
// draws if the flag is turned on, so they turn it on.
vi.mock('./mobile-native-chat-turn-edits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mobile-native-chat-turn-edits')>()),
  TURN_EDITS_CARD_SHOWN: true
}))
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }))
vi.mock('lucide-react-native', () => {
  const icons: Record<string, string> = {}
  return new Proxy(icons, {
    get: (_target, name) => (typeof name === 'string' ? name : undefined),
    has: () => true
  })
})
vi.mock('../components/MobileMarkdown', () => ({ MobileMarkdown: 'MobileMarkdown' }))
vi.mock('./MobileNativeChatDiffCard', () => ({ MobileNativeChatDiffCard: 'DiffCard', MAX_DIFF_CARD_ROWS: 200 }))
vi.mock('../components/BottomDrawer', async () => {
  const React = await import('react')
  return {
    BottomDrawer: ({ visible, header, children }: { visible: boolean; header?: ReactNode; children?: ReactNode }) =>
      visible ? React.createElement('BottomDrawer', null, header, children as ReactNode) : null
  }
})

import { ThemeProvider } from '../theme/theme-context'

/** The provider as these tests mount it: createElement passes its child as the third argument. */
const Themed = ThemeProvider as unknown as ComponentType<{ initialPreference: 'light' | 'dark'; children?: ReactNode }>
import { darkColors, lightColors } from '../theme/tokens'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { foldMobileNativeChatMessages } from './mobile-native-chat-render-data'
import { turnEditedFiles, turnEditsStat, turnEditsTitle, type TurnEditedFile } from './mobile-native-chat-turn-edits'
import { useMobileNativeChatTurnEnds, type MobileNativeChatTurnEndProps } from './use-mobile-native-chat-turn-ends'
import { NativeChatAgentRunsContext } from './native-chat-tasks-context'
import { CLAUDE_EDIT_RUN_ROWS } from './fixtures/claude-edit-runs-2.1.282'

// The Claude app 1.261009.20 draws a card under a finished turn that changed
// files (h130, `ccr_turn_edits_*`): "Edited run.sh" for one file, the run
// sentence for several, the turn's "+A −R", Review, and past one file a row
// each, three and then "Show N more". Ours had only each edit's own diff card
// inside its run, with nothing at the turn's end.

/** One Claude Code 2.1.282 turn (fixtures/claude-edit-runs-2.1.282.ts): a
 *  Write of a new 93-line file whose content the wire cut, then an Edit of
 *  run.sh with one resolved hunk, +14 −2. */
const TURN = foldMobileNativeChatMessages(CLAUDE_EDIT_RUN_ROWS)
const CREATED = '/Users/dev/Desktop/Project/Sample/hybrid-model/scripts/cluster/jobs/queue-sweep-k-one.sh'
const EDITED = '/Users/dev/Desktop/Project/Sample/hybrid-model/scripts/cluster/jobs/run.sh'

function file(path: string, created = false, stat: TurnEditedFile['stat'] = { added: 1, removed: 0 }): TurnEditedFile {
  return { path, created, stat, changes: [] }
}

describe('the files a turn changed', () => {
  it('lists a real turn’s create and edit, the cut create without a count', () => {
    const files = turnEditedFiles(TURN)
    expect(files.map(({ path, created, stat }) => ({ path, created, stat }))).toEqual([
      { path: CREATED, created: true, stat: null },
      { path: EDITED, created: false, stat: { added: 14, removed: 2 } }
    ])
    expect(files.map((entry) => entry.changes.length)).toEqual([1, 1])
    expect(turnEditsTitle(files)).toBe('Edited a file, created a file')
    // One count unknown: no total, never the part that survived.
    expect(turnEditsStat(files)).toBeNull()
  })

  it('names one file by its own name', () => {
    expect(turnEditsTitle([file(EDITED)])).toBe('Edited run.sh')
    expect(turnEditsTitle([file(CREATED, true)])).toBe('Created queue-sweep-k-one.sh')
  })

  it('finds nothing in a turn with no edits, or a Codex 0.153.4 exec script that applies a patch', () => {
    expect(turnEditedFiles([])).toEqual([])
    const codexExec: NativeChatMessage = {
      id: 'c1',
      role: 'assistant',
      timestamp: null,
      source: 'transcript',
      blocks: [
        {
          type: 'tool-call',
          name: 'exec',
          input:
            'const patch = "*** Begin Patch\\n*** Update File: src/a.ts\\n@@\\n-was\\n+now\\n*** End Patch";\nconst out = await tools.apply_patch(patch);\ntext(out);\n'
        },
        { type: 'tool-result', output: 'Script completed\nWall time: 0.4 seconds\n{}' }
      ]
    }
    expect(turnEditedFiles([codexExec])).toEqual([])
  })
})

// Review of 2026-10-12: a landed edit the phone cannot read (the wire dropped
// the keys that held a Write's content) was skipped, and the card named the other file with a
// total, while the run's own chip drew no count. Refuse the card instead.
describe('a turn with an edit the phone cannot read', () => {
  const droppedWrite: NativeChatMessage = {
    id: 'm1',
    role: 'assistant',
    timestamp: null,
    source: 'transcript',
    blocks: [
      { type: 'tool-call', name: 'Write', input: { file_path: '/repo/a.ts', '…': 'truncated' } },
      { type: 'tool-result', output: 'File created successfully at: /repo/a.ts' }
    ]
  }

  it('gets no card, rather than a list and total that leave the edit out', () => {
    expect(turnEditedFiles([...TURN, droppedWrite])).toEqual([])
  })

  it('works each call out once: the same records folded again give the same changes', () => {
    const first = turnEditedFiles(TURN)
    const again = turnEditedFiles(foldMobileNativeChatMessages(CLAUDE_EDIT_RUN_ROWS))
    expect(again[1]!.changes[0]).toBe(first[1]!.changes[0])
  })
})

describe('the turn the list names', () => {
  it('hands the turn’s files to the row that ends it, and to no other row', () => {
    const seen: Record<string, MobileNativeChatTurnEndProps> = {}
    function Probe({ rows }: { rows: NativeChatMessage[] }) {
      const props = useMobileNativeChatTurnEnds(rows)
      for (const row of rows) {
        seen[row.id] = props(row.id)
      }
      return null
    }
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(Probe, { rows: TURN }))
    })
    const ends = Object.entries(seen).filter(([, props]) => props.endsTurn)
    expect(ends).toHaveLength(1)
    expect(ends[0]![1].turnEdits?.map((entry) => entry.path)).toEqual([CREATED, EDITED])
    expect(Object.entries(seen).filter(([, props]) => !props.endsTurn).every(([, props]) => props.turnEdits === undefined)).toBe(true)
    act(() => renderer!.unmount())
  })

  // Every transcript update re-reads every turn; a row handed a new but equal
  // list would re-render each time, for every turn with edits in the chat.
  it('hands back the same list while the turn’s files read the same, and a new one when they change', () => {
    const lists: (readonly TurnEditedFile[] | undefined)[] = []
    function Probe({ rows }: { rows: NativeChatMessage[] }) {
      const props = useMobileNativeChatTurnEnds(rows)
      lists.push(props(rows.at(-1)!.id).turnEdits)
      return null
    }
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(Probe, { rows: TURN }))
    })
    // The same records folded again: new objects, the same card.
    act(() => renderer!.update(createElement(Probe, { rows: foldMobileNativeChatMessages(CLAUDE_EDIT_RUN_ROWS) })))
    expect(lists.at(-1)).toBe(lists[0])
    // Only the create left: a different card.
    const editIndex = CLAUDE_EDIT_RUN_ROWS.findIndex((row) => row.blocks.some((block) => block.type === 'tool-call' && block.name === 'Edit'))
    act(() => renderer!.update(createElement(Probe, { rows: foldMobileNativeChatMessages(CLAUDE_EDIT_RUN_ROWS.slice(0, editIndex)) })))
    expect(lists.at(-1)).not.toBe(lists[0])
    act(() => renderer!.unmount())
  })
})

describe('the turn edits card', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(
    files: TurnEditedFile[],
    { scheme = 'light', newest = false, working = false }: { scheme?: 'light' | 'dark'; newest?: boolean; working?: boolean } = {}
  ): ReactTestInstance {
    act(() => renderer?.unmount())
    act(() => {
      renderer = create(
        createElement(
          Themed,
          { initialPreference: scheme },
          createElement(
            NativeChatAgentRunsContext.Provider,
            { value: { runningIds: new Set<string>(), confirmed: new Map<string, string>(), agentWorking: working } },
            createElement(MobileNativeChatMessage, {
              message: TURN.at(-1)!,
              endsTurn: true,
              turnIsNewest: newest,
              turnEdits: files
            })
          )
        )
      )
    })
    return renderer!.root
  }
  const card = (root: ReactTestInstance) => root.findAll((node) => node.props.testID === 'turn-edits-card' && typeof node.type === 'string')
  const texts = (node: ReactTestInstance): string[] =>
    node.findAll((entry) => (entry.type as unknown) === 'Text').map((entry) => [entry.props.children].flat().join(''))
  const button = (root: ReactTestInstance, label: string) =>
    root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0]!

  it('draws a real turn’s card: the sentence, a row per file, the edit’s count, and Review opening both changes', () => {
    const root = render(turnEditedFiles(TURN))
    expect(card(root)).toHaveLength(1)
    const words = texts(card(root)[0]!)
    expect(words).toEqual(expect.arrayContaining(['Edited a file, created a file', 'queue-sweep-k-one.sh', 'run.sh', '+14', '−2', 'Review']))
    // The turn's total is unknown, so the heading has no pill; only run.sh's row does.
    expect(card(root)[0]!.findAll((node) => node.props.testID === 'tool-run-diff-chip' && typeof node.type === 'string')).toHaveLength(1)
    act(() => button(root, 'Review').props.onPress())
    const sheet = root.findAll((node) => (node.type as unknown) === 'BottomDrawer')
    expect(sheet).toHaveLength(1)
    expect(sheet[0]!.findAll((node) => (node.type as unknown) === 'DiffCard')).toHaveLength(2)
  })

  it('names a one-file turn by its file and lists no rows', () => {
    const root = render([file(EDITED, false, { added: 14, removed: 2 })])
    const words = texts(card(root)[0]!)
    expect(words).toContain('Edited run.sh')
    expect(card(root)[0]!.findAll((node) => node.props.testID === 'turn-edits-file' && typeof node.type === 'string')).toHaveLength(0)
  })

  it('lists three files, then "Show 2 more", then all five and "Show less"', () => {
    const five = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((name) => file(`/w/${name}`))
    const root = render(five)
    const rows = () => card(root)[0]!.findAll((node) => node.props.testID === 'turn-edits-file' && typeof node.type === 'string')
    expect(rows()).toHaveLength(3)
    act(() => button(root, 'Show 2 more').props.onPress())
    expect(rows()).toHaveLength(5)
    expect(texts(card(root)[0]!)).toContain('Show less')
  })

  it('draws no "Show more" for exactly three files', () => {
    const root = render(['a.ts', 'b.ts', 'c.ts'].map((name) => file(`/w/${name}`)))
    expect(texts(card(root)[0]!).some((text) => text.startsWith('Show '))).toBe(false)
  })

  // Review of 2026-10-12: paused on a permission, the agent is not working,
  // but the turn is not over: its last call has no answer yet.
  it('waits while the newest turn’s last call is unanswered, as at a permission prompt', () => {
    const open: NativeChatMessage['blocks'] = [{ type: 'tool-call', name: 'Bash', input: { command: 'pnpm test' } }]
    act(() => renderer?.unmount())
    act(() => {
      renderer = create(
        createElement(
          Themed,
          { initialPreference: 'light' },
          createElement(MobileNativeChatMessage, {
            message: TURN.at(-1)!,
            endsTurn: true,
            turnIsNewest: true,
            turnTrailingWork: open,
            turnEdits: turnEditedFiles(TURN)
          })
        )
      )
    })
    expect(card(renderer!.root)).toHaveLength(0)
  })

  it('waits for the newest turn to finish, and draws nothing for a turn with no edits', () => {
    expect(card(render(turnEditedFiles(TURN), { newest: true, working: true }))).toHaveLength(0)
    expect(card(render(turnEditedFiles(TURN), { newest: true, working: false }))).toHaveLength(1)
    expect(card(render([]))).toHaveLength(0)
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('takes its frame from the %s theme', (scheme, palette) => {
    const root = render(turnEditedFiles(TURN), { scheme })
    const style = Object.assign({}, ...[card(root)[0]!.props.style].flat(Infinity).filter(Boolean)) as Record<string, unknown>
    expect(style.borderColor).toBe(palette.border)
    expect(style.backgroundColor).toBe(palette.bgPanel)
  })
})
