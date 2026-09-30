// A Monitor read from the transcript now reaches the task card as a monitor, not a shell: the card
// draws its own glyph (Activity, not the terminal) and the word "Monitor", in the theme's ink, light
// and dark. Nothing in the card changed; this pins that the monitor row lands on its existing branch.

import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915 })
}))
vi.mock('lucide-react-native', () => ({
  Activity: 'Activity',
  ChevronRight: 'ChevronRight',
  CircleStop: 'CircleStop',
  Diamond: 'Diamond',
  ListTree: 'ListTree',
  Terminal: 'Terminal'
}))

import { deriveBackgroundTasks } from './mobile-background-tasks'
import { MobileBackgroundTaskCard } from './MobileBackgroundTaskCard'

const T0 = Date.UTC(2026, 8, 30, 12, 0, 0)
// Verbatim Monitor result from this machine's transcript, 2026-09-09 (mobile-background-tasks.test.ts).
const MONITOR: NativeChatMessage[] = [
  {
    id: 'call',
    role: 'assistant',
    timestamp: T0,
    source: 'transcript',
    blocks: [{ type: 'tool-call', name: 'Monitor', input: { command: 'tail -f build.log', description: 'Watch the build log' } }]
  },
  {
    id: 'result',
    role: 'user',
    timestamp: T0 + 500,
    source: 'transcript',
    blocks: [
      {
        type: 'tool-result',
        output:
          'Monitor started (task bmon12345, timeout 3000000ms). You will be notified on each event. Keep working — do not poll or sleep. Events may arrive while you are waiting for the user — an event is not their reply.'
      }
    ]
  }
]

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

describe('a Monitor on its task card, in light and dark', () => {
  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)('draws the monitor glyph and "Monitor" in %s ink', (scheme, palette) => {
    const task = deriveBackgroundTasks(MONITOR, T0 + 60_000).running[0]!
    act(() => {
      renderer = create(
        <ThemeProvider initialPreference={scheme}>
          <MobileBackgroundTaskCard task={task} />
        </ThemeProvider>
      )
    })
    const glyphs = renderer!.root.findAll((node) => ['Activity', 'Terminal'].includes(node.type as unknown as string))
    expect(glyphs.map((node) => node.type)).toEqual(['Activity'])
    expect(glyphs[0]!.props.color).toBe(palette.textSecondary)
    const words = renderer!.root
      .findAll((node) => (node.type as unknown) === 'Text')
      .map((node) => [node.props.children].flat().join(''))
    expect(words).toContain('Monitor')
    expect(words).not.toContain('Shell')
  })
})
