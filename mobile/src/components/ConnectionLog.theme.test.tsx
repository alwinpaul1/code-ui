import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The connection log (pairing, reconnect, Troubleshoot) in both themes. It painted from the LEGACY
 * static palette (`mobile-theme.ts`), which is dark-only, until the 2026-09-27 sweep; this pins
 * the card, its heading, the timestamps and each level's colour so it cannot drift back.
 */

vi.mock('react-native', () => ({
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))

import { ThemeProvider } from '../theme/theme-context'
import { darkColors, lightColors } from '../theme/tokens'
import type { ConnectionLogEntry } from '../transport/types'
import { ConnectionLog } from './ConnectionLog'

const ENTRIES: ConnectionLogEntry[] = [
  {
    id: 'a',
    ts: 1_000,
    level: 'info',
    message: 'Opening WebSocket',
    detail: 'ws://192.168.1.10:6768'
  },
  { id: 'b', ts: 1_250, level: 'success', message: 'Connected' },
  { id: 'c', ts: 1_400, level: 'warn', message: 'Relay slow' },
  { id: 'd', ts: 1_500, level: 'error', message: 'Handshake failed' }
]

function flat(style: unknown): Record<string, unknown> {
  const list = Array.isArray(style) ? style.flat(Infinity) : [style]
  return Object.assign(
    {},
    ...list.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
    )
  )
}

describe('the connection log', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it.each([
    ['light', lightColors],
    ['dark', darkColors]
  ] as const)(
    'draws its card, heading, timestamps and levels from the %s theme',
    (scheme, palette) => {
      act(() => {
        renderer = create(
          <ThemeProvider initialPreference={scheme}>
            <ConnectionLog entries={ENTRIES} title="Pairing" />
          </ThemeProvider>
        )
      })
      const root = renderer!.root
      const text = (children: string): ReactTestInstance =>
        root.find((node) => String(node.type) === 'Text' && node.props.children === children)

      const card = root.findAll((node) => String(node.type) === 'View')[0]!
      expect(flat(card.props.style)).toMatchObject({
        backgroundColor: palette.bgPanel,
        borderColor: palette.border
      })
      expect(flat(text('Pairing').props.style).color).toBe(palette.textMuted)
      expect(flat(text('+0.00s').props.style).color).toBe(palette.textMuted)
      expect(flat(text('ws://192.168.1.10:6768').props.style).color).toBe(palette.textMuted)
      expect(flat(text('Opening WebSocket').props.style).color).toBe(palette.textSecondary)
      expect(flat(text('Connected').props.style).color).toBe(palette.success)
      expect(flat(text('Relay slow').props.style).color).toBe(palette.warning)
      expect(flat(text('Handshake failed').props.style).color).toBe(palette.danger)
    }
  )
})
