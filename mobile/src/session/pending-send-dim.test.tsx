// S2 of docs/claude-app-parity-gaps.md: a send's bubble is dimmed (50%, the Claude app's
// pending_message) until the desktop acks its write, full strength from then. No "Sending"
// label: the user removed it on 2026-10-10 and has not asked for it back.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../theme/theme-context'

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))

import { MobileNativeChatPendingDim, PENDING_SEND_DIM_OPACITY } from './MobileNativeChatPendingDim'
import type { OutboxDelivery } from './use-native-chat-outbox-recovery'

let renderer: ReactTestRenderer | null = null

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
})

function opacityOf(delivery: OutboxDelivery | undefined, scheme: 'light' | 'dark'): unknown {
  act(() => {
    renderer?.unmount()
    renderer = create(
      <ThemeProvider initialPreference={scheme}>
        <MobileNativeChatPendingDim delivery={delivery}>{createElement('Text', null, 'deploy it')}</MobileNativeChatPendingDim>
      </ThemeProvider>
    )
  })
  const wrapper = renderer!.root.findAll((node) => (node.type as unknown) === 'View')[0]!
  return (wrapper.props.style as { opacity?: number }).opacity
}

describe('a send’s bubble while the desktop has not taken it', () => {
  it.each(['light', 'dark'] as const)('is dimmed to half while on its way, and full once taken or failed (%s)', (scheme) => {
    expect(opacityOf('sending', scheme)).toBe(PENDING_SEND_DIM_OPACITY)
    expect(PENDING_SEND_DIM_OPACITY).toBe(0.5)
    // Taken: the desktop acked its write and Claude's record is still out (S2, 2026-10-12).
    expect(opacityOf('taken', scheme)).toBe(1)
    expect(opacityOf(undefined, scheme)).toBe(1)
    expect(opacityOf('failed', scheme)).toBe(1)
  })

  it('says nothing: no "Sending" label is drawn', () => {
    opacityOf('sending', 'light')
    const texts = renderer!.root.findAll((node) => (node.type as unknown) === 'Text').map((node) => [node.props.children].flat().join(''))
    expect(texts).toEqual(['deploy it'])
  })

  it('wraps every chat row in it, keyed by the row’s own outbox delivery', () => {
    // A structure, not a value: which delivery the dim reads. Code lines only, not commentary.
    const source = readFileSync(join(__dirname, 'MobileNativeChatView.tsx'), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n')
    expect(source).toMatch(/<MobileNativeChatPendingDim delivery=\{outboxDeliveries\?\.\[item\.id\]\}><MobileNativeChatMessage\b/)
    expect(source).toMatch(/\/><\/MobileNativeChatPendingDim>/)
  })
})
