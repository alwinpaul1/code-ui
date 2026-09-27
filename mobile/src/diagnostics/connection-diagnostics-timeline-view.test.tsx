import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionLogEntry } from '../transport/types'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
  useColorScheme: () => 'light'
}))
vi.mock('lucide-react-native', () => ({ ChevronDown: 'ChevronDown', ChevronRight: 'ChevronRight' }))

import { ThemeProvider } from '../theme/theme-context'
import { buildConnectionTimeline } from './connection-diagnostics-timeline'
import { ConnectionDiagnosticsTimeline } from './connection-diagnostics-timeline-view'
import { localTime, reportedLogTail } from './connection-diagnostics-timeline.test-fixture'

const LIVE = { tone: 'success', text: 'Connected via Relay since 14:20:09' } as const

function view(entries: readonly ConnectionLogEntry[]) {
  return (
    <ThemeProvider initialPreference="light">
      <ConnectionDiagnosticsTimeline
        title="Host 1"
        live={LIVE}
        rows={buildConnectionTimeline(entries)}
      />
    </ThemeProvider>
  )
}

function render(
  entries: readonly ConnectionLogEntry[],
  scrollToEnd: () => void = () => undefined
): ReactTestRenderer {
  const rendered: { tree: ReactTestRenderer | null } = { tree: null }
  act(() => {
    rendered.tree = create(view(entries), { createNodeMock: () => ({ scrollToEnd }) })
  })
  if (rendered.tree === null) {
    throw new Error('the timeline did not mount')
  }
  return rendered.tree
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('')
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root.findAll((node) => String(node.type) === 'Text').map(textOf)
}

function fold(tree: ReactTestRenderer): ReactTestInstance {
  return tree.root.find(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.findAll(
        (child) => String(child.type) === 'Text' && textOf(child).startsWith('Direct Wi-Fi path:')
      ).length > 0
  )
}

function contentSizeChanged(tree: ReactTestRenderer): void {
  act(() => {
    tree.root.find((node) => String(node.type) === 'ScrollView').props.onContentSizeChange()
  })
}

/** The LAN loop ran on. Its next close joins the fold, so the row count stays the same. */
function oneMoreClose(entries: readonly ConnectionLogEntry[]): ConnectionLogEntry[] {
  const at = localTime(14, 22, 17, 240)
  return [
    ...entries.filter((entry) => entry.ts < localTime(14, 22, 16)),
    {
      id: 'log-reconnecting-8',
      ts: at,
      level: 'info',
      message: 'Reconnecting (attempt 8)',
      detail: '192.168.137.1:6768',
      path: 'lan'
    },
    {
      id: 'log-closed-8',
      ts: at + 10_000,
      level: 'warn',
      message: 'WebSocket closed',
      detail: 'Close code 1006; reconnect scheduled',
      code: 'socket-closed',
      path: 'lan'
    }
  ]
}

// Review, 2026-09-27: the list followed new events only when its ROW count changed, so a close
// that joined the open fold, or a log sliding its 200-entry window, never scrolled into view.
describe('the diagnostics timeline following new events', () => {
  it('scrolls to a new event that lands inside the fold', () => {
    const scrollToEnd = vi.fn()
    const first = reportedLogTail().filter((entry) => entry.ts < localTime(14, 22, 16))
    const tree = render(first, scrollToEnd)
    contentSizeChanged(tree)
    expect(scrollToEnd).toHaveBeenCalledTimes(1)

    act(() => {
      tree.update(view(oneMoreClose(first)))
    })
    contentSizeChanged(tree)

    expect(scrollToEnd).toHaveBeenCalledTimes(2)
  })

  it('does not scroll away when the user opens a fold', () => {
    const scrollToEnd = vi.fn()
    const tree = render(reportedLogTail(), scrollToEnd)
    contentSizeChanged(tree)

    act(() => {
      fold(tree).props.onPress()
    })
    contentSizeChanged(tree)

    expect(scrollToEnd).toHaveBeenCalledTimes(1)
  })
})

// Review, 2026-09-27: a fold was keyed by its first line, so the log dropping that line as it
// slid closed the fold the user had opened.
describe('an opened fold', () => {
  it('stays open when its oldest line leaves the log window', () => {
    const entries = reportedLogTail()
    const tree = render(entries)
    act(() => {
      fold(tree).props.onPress()
    })
    expect(texts(tree).filter((text) => text === 'WebSocket closed')).toHaveLength(7)

    const firstClose = entries.findIndex((entry) => entry.code === 'socket-closed')
    const slid = entries.filter((_, index) => index !== firstClose)
    act(() => {
      tree.update(view(slid))
    })

    expect(texts(tree).filter((text) => text === 'WebSocket closed')).toHaveLength(6)
  })
})

// Review, 2026-09-27: a "client N" line under every row doubled the list for the common case of
// one client, where the label says nothing.
describe('client labels', () => {
  it('stay off when one client wrote everything in view', () => {
    const oneClient = reportedLogTail().map((entry) => ({ ...entry, clientGeneration: 4 }))

    expect(texts(render(oneClient)).filter((text) => text.startsWith('client '))).toEqual([])
  })

  it('name each client when two are in view', () => {
    const tail = reportedLogTail()
    const twoClients = [
      ...tail.map((entry) => ({ ...entry, clientGeneration: 4 })),
      { ...tail[tail.length - 1]!, id: 'late', ts: localTime(14, 23, 0), clientGeneration: 5 }
    ]

    const labels = texts(render(twoClients)).filter((text) => text.startsWith('client '))

    expect(labels).toContain('client 4')
    expect(labels).toContain('client 5')
  })
})
