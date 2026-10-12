import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Opus review, 2026-10-12: the card listened to the hardware key directly, so
// inside the web shell's page (no hardware key) Back did not close it. Every
// other Back in the app goes through useBackClaim, which covers both.

const claims = vi.hoisted(() => [] as ((() => boolean) | null)[])
vi.mock('../navigation/use-back-claim', () => ({
  useBackClaim: (claim: (() => boolean) | null) => {
    claims.push(claim)
  }
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, flatten: (s: unknown) => s },
  Text: 'Text',
  View: 'View',
  useColorScheme: () => 'light'
}))
vi.mock('react-native-svg', () => ({ default: 'Svg', Circle: 'Circle' }))
vi.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined), has: () => true })
)

import { ThemeProvider } from '../theme/theme-context'
import { MobileNativeChatTodoCard } from './MobileNativeChatTodoCard'

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  claims.length = 0
})

describe('Back on the todo card', () => {
  it('is claimed through the app’s Back seam, and closes the card', () => {
    const onClose = vi.fn()
    act(() => {
      renderer = create(
        <ThemeProvider>
          <MobileNativeChatTodoCard
            list={{ tasks: [{ content: 'Fix the parser', status: 'in_progress' }] }}
            working={false}
            onClose={onClose}
          />
        </ThemeProvider>
      )
    })
    const claim = claims.at(-1)
    expect(typeof claim).toBe('function')
    expect(claim!()).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
