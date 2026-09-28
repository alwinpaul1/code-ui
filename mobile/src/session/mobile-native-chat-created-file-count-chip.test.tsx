// The report of 2026-09-26: the Claude app heads "Created a file, ran a
// command" with "+93 −0", and the phone drew no count at all, because the
// wire cut the Write's content at 4000 characters. The run now reads the file
// back from the desktop and draws the count when the file is provably the one
// the Write made, and still nothing when it is not.

import type { ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  NativeChatMessage,
  NativeChatToolCallBlock
} from '../../../src/shared/native-chat-types'
import type { RpcResponse } from '../transport/types'
import { darkColors, lightColors } from '../theme/tokens'
import { ThemeProvider } from '../theme/theme-context'
import { useChatMessageStyles } from './mobile-native-chat-message-styles'
import { ToolRun } from './MobileNativeChatToolRun'
import { CreatedFileCountProvider } from './MobileNativeChatCreatedFileCounts'
import {
  createCreatedFileCountStore,
  type CreatedFileCountStore
} from './mobile-native-chat-created-file-count-store'
import {
  CLAUDE_EDIT_RUN_ROWS,
  CREATED_A_FILE_RUN,
  CREATED_FILE_ON_DISK
} from './fixtures/claude-edit-runs-2.1.282'

vi.mock('../components/DraggableDetailSheet', async () => {
  const React = await import('react')
  return {
    DraggableDetailSheet: ({
      visible,
      header,
      children
    }: {
      visible: boolean
      header?: ReactNode
      children?: ReactNode
    }) => (visible ? React.createElement('DraggableDetailSheet', null, header, children) : null)
  }
})
// The tool sheet this renders now draws Markdown prose inputs through MobileMarkdown, whose
// imports this file's react-native mock cannot load; the sheet's Markdown is tested in
// MobileNativeChatToolDetailSheet.test.tsx.
vi.mock('../components/MobileMarkdown', async () => {
  const React = await import('react')
  return {
    MobileMarkdown: ({ content }: { content: string }) => React.createElement('Text', null, content)
  }
})

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
  // Android 14, the user's S23: a running row's shimmer asks (MobileNativeChatShimmerText).
  Platform: { OS: 'android', Version: 34 },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({
  ChevronDown: 'ChevronDown',
  ChevronRight: 'ChevronRight',
  FileMinus2: 'FileMinus2',
  FilePen: 'FilePen',
  FilePlus2: 'FilePlus2',
  SquareChevronRight: 'SquareChevronRight',
  SquareTerminal: 'SquareTerminal',
  Wrench: 'Wrench'
}))

const WORKTREE_ROOT = '/Users/dev/Desktop/Project/Sample'
const PATH = ((CREATED_A_FILE_RUN[0] as NativeChatToolCallBlock).input as { file_path: string })
  .file_path

function success(result: unknown): RpcResponse {
  return { id: 'rpc', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function inWorktree(pathText: string): RpcResponse {
  const relativePath = pathText.slice(WORKTREE_ROOT.length + 1)
  return success({
    worktree: 'wt-1',
    relativePath,
    absolutePath: pathText,
    exists: true,
    isDirectory: false,
    openTarget: { kind: 'worktree-file', provider: 'local', relativePath, absolutePath: pathText }
  })
}

/** A desktop holding `content` at the fixture's path; `online` says whether
 *  the relay gets a request through. */
function desktop(content: string, state = { online: true }) {
  const sendRequest = vi.fn(async (method: string, params?: unknown) => {
    if (!state.online) {
      throw new Error('Not connected')
    }
    if (method === 'files.resolveTerminalPath') {
      return inWorktree((params as { pathText: string }).pathText)
    }
    if (method === 'files.read') {
      return success({ content, truncated: false, byteLength: content.length })
    }
    throw new Error(`unexpected ${method}`)
  })
  return { client: { sendRequest }, state }
}

const LATER_EDIT: NativeChatMessage = {
  id: 'later-edit',
  role: 'assistant',
  blocks: [
    {
      type: 'tool-call',
      name: 'Edit',
      input: { file_path: PATH, old_string: 'a', new_string: 'b' }
    }
  ],
  timestamp: null,
  source: 'transcript'
} as NativeChatMessage

/** The run's last call, the command after the create. */
const RUNNING_COMMAND = CREATED_A_FILE_RUN.findLast(
  (block): block is NativeChatToolCallBlock => block.type === 'tool-call'
)!

type HarnessProps = {
  activeCall?: NativeChatToolCallBlock | null
  focusView?: boolean
  expanded?: boolean
  expandChildren?: boolean
}

function Harness({
  activeCall = null,
  focusView = false,
  expanded = true,
  expandChildren
}: HarnessProps): React.JSX.Element {
  const styles = useChatMessageStyles()
  return (
    <ToolRun
      blocks={CREATED_A_FILE_RUN}
      defaultExpanded={expanded}
      activeCall={activeCall}
      focusView={focusView}
      expandChildren={expandChildren}
      styles={styles}
    />
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })
}

describe('a created file the wire cut, in the chat', () => {
  let renderer: ReactTestRenderer | null = null
  let store: CreatedFileCountStore
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    store = createCreatedFileCountStore()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    warn.mockRestore()
  })

  function connect(client: unknown, lastConnectedAt: number): void {
    act(() => {
      store.configure({
        client: client as Parameters<CreatedFileCountStore['configure']>[0]['client'],
        hostId: 'host-1',
        worktreeId: 'wt-1',
        lastConnectedAt
      })
    })
  }

  function chat(
    messages: readonly NativeChatMessage[],
    scheme: 'light' | 'dark',
    harness: HarnessProps = {}
  ) {
    return (
      <ThemeProvider initialPreference={scheme}>
        <CreatedFileCountProvider store={store} messages={messages} live>
          <Harness {...harness} />
        </CreatedFileCountProvider>
      </ThemeProvider>
    )
  }

  function render(
    messages: readonly NativeChatMessage[],
    scheme: 'light' | 'dark' = 'light',
    harness: HarnessProps = {}
  ) {
    act(() => {
      renderer = create(chat(messages, scheme, harness))
    })
  }

  /** The transcript a new connection brings: the same rows, a new list. */
  function replay(messages: readonly NativeChatMessage[]) {
    act(() => {
      renderer!.update(chat([...messages], 'light'))
    })
  }

  function byId(id: string) {
    return renderer!.root.findAll(
      (node) => node.props?.testID === id && typeof node.type === 'string'
    )
  }

  function texts(): string[] {
    // Every host node with a string child is a Text under this mock.
    return renderer!.root
      .findAll((node) => typeof node.type === 'string')
      .map((node) => node.props.children as unknown)
      .filter((child): child is string => typeof child === 'string')
  }

  function colourOf(id: string): string | undefined {
    const style = byId(id)[0]?.props.style
    const entries = Array.isArray(style) ? style.flat(3) : [style]
    let found: string | undefined
    for (const entry of entries) {
      const value = (entry as Record<string, unknown> | null | undefined)?.color
      if (typeof value === 'string') {
        found = value
      }
    }
    return found
  }

  it.each(['light', 'dark'] as const)(
    "heads the run and its card with the Claude app's +93 −0 once the file proves it, in %s",
    async (scheme) => {
      const host = desktop(CREATED_FILE_ON_DISK)
      connect(host.client, 1)
      render(CLAUDE_EDIT_RUN_ROWS, scheme)
      await settle()
      const palette = scheme === 'dark' ? darkColors : lightColors
      for (const [id, text, colour] of [
        ['tool-run-diff-added', '+93', palette.diffAddText],
        ['tool-run-diff-removed', '−0', palette.diffDelText],
        ['diff-card-added', '+93', palette.diffAddText],
        ['diff-card-removed', '−0', palette.diffDelText]
      ] as const) {
        expect(byId(id).map((node) => node.props.children)).toEqual([text])
        expect(colourOf(id)).toBe(colour)
      }
      // The card's rows are still the part the wire kept.
      expect(texts()).toContain('Diff truncated')
    }
  )

  it('draws no number for a created file the agent edited later, and never reads it', async () => {
    const host = desktop(CREATED_FILE_ON_DISK)
    connect(host.client, 1)
    render([...CLAUDE_EDIT_RUN_ROWS, LATER_EDIT])
    await settle()
    expect(byId('tool-run-diff-added')).toHaveLength(0)
    expect(byId('diff-card-added')).toHaveLength(0)
    expect(texts()).toContain('Diff truncated')
    expect(host.client.sendRequest).not.toHaveBeenCalled()
  })

  it('draws no number for a created file changed on the desktop since', async () => {
    const host = desktop(CREATED_FILE_ON_DISK.replace('step 03', 'step 3b'))
    connect(host.client, 1)
    render(CLAUDE_EDIT_RUN_ROWS)
    await settle()
    expect(byId('tool-run-diff-added')).toHaveLength(0)
    expect(byId('diff-card-added')).toHaveLength(0)
  })

  it('draws no number while the read is rejected, then the count once the relay reconnects', async () => {
    const host = desktop(CREATED_FILE_ON_DISK, { online: false })
    connect(host.client, 1)
    render(CLAUDE_EDIT_RUN_ROWS)
    await settle()
    expect(byId('tool-run-diff-added')).toHaveLength(0)
    host.state.online = true
    connect(host.client, 2)
    replay(CLAUDE_EDIT_RUN_ROWS)
    await settle()
    expect(byId('tool-run-diff-added').map((node) => node.props.children)).toEqual(['+93'])
  })

  // Review of 2026-09-26: a run still going may touch the file with its next
  // call, and a run folded away in focus view draws no count at all, yet both
  // read the file.
  it('reads nothing while the run is still going, and counts it once the run is done', async () => {
    const host = desktop(CREATED_FILE_ON_DISK)
    connect(host.client, 1)
    render(CLAUDE_EDIT_RUN_ROWS, 'light', { activeCall: RUNNING_COMMAND })
    await settle()
    expect(host.client.sendRequest).not.toHaveBeenCalled()
    act(() => {
      renderer!.update(chat(CLAUDE_EDIT_RUN_ROWS, 'light'))
    })
    await settle()
    expect(byId('tool-run-diff-added').map((node) => node.props.children)).toEqual(['+93'])
  })

  it('reads nothing for a run folded away in focus view, and counts it on the card once unfolded', async () => {
    const host = desktop(CREATED_FILE_ON_DISK)
    connect(host.client, 1)
    render(CLAUDE_EDIT_RUN_ROWS, 'light', {
      focusView: true,
      expanded: false,
      expandChildren: true
    })
    await settle()
    expect(host.client.sendRequest).not.toHaveBeenCalled()
    act(() => {
      byId('tool-run-header')[0]!.props.onPress()
    })
    await settle()
    expect(byId('diff-card-added').map((node) => node.props.children)).toEqual(['+93'])
    expect(byId('tool-run-diff-added')).toHaveLength(0)
  })

  it('reads nothing and draws no number when the chat has no reader', async () => {
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference="light">
          <Harness />
        </ThemeProvider>
      )
    })
    await settle()
    expect(byId('tool-run-diff-added')).toHaveLength(0)
    expect(texts()).toContain('Diff truncated')
  })
})
