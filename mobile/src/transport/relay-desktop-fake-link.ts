import { vi } from 'vitest'

// The cell socket, replaced for suites that drive the real relay session above
// it (relay-desktop-test-fakes.ts). A suite installs it with:
//
//   vi.mock('./mobile-relay-e2ee-link', async (importOriginal) => ({
//     ...(await importOriginal<typeof import('./mobile-relay-e2ee-link')>()),
//     MobileRelayE2eeLink: (await import('./relay-desktop-fake-link')).FakeRelayLink
//   }))
//
// This module must not import the link module itself: the mock factory loads
// it, and a cycle through the module being mocked never resolves.

type LinkOptions = {
  onAuthenticated: () => void
  onText: (plaintext: string) => void
  onHello?: (hello: Record<string, unknown>) => void
  onError: (error: Error) => void
}

export type RelayFrame = { id: string; method?: string; params?: Record<string, unknown> }

/** Every cell socket the phone opened, oldest first. */
export const fakeRelayLinks: FakeRelayLink[] = []

/** What the cell does with each socket the phone opens from now on; null
 *  leaves it to the test (accept it, drop it, or let it hang). */
export const fakeRelayCell: { onOpen: ((link: FakeRelayLink) => void) | null } = { onOpen: null }

export class FakeRelayLink {
  readonly frames: RelayFrame[] = []
  /** What the desktop answers to a request, or undefined to leave it unanswered. */
  answer: ((frame: RelayFrame) => unknown) | null = null
  dead = false
  readonly close = vi.fn()

  constructor(readonly options: LinkOptions) {
    fakeRelayLinks.push(this)
    const onOpen = fakeRelayCell.onOpen
    if (onOpen) {
      queueMicrotask(() => onOpen(this))
    }
  }

  readonly sendText = vi.fn((plaintext: string): boolean => {
    if (this.dead) {
      return false
    }
    const frame = JSON.parse(plaintext) as RelayFrame
    this.frames.push(frame)
    const answer = this.answer
    if (answer) {
      queueMicrotask(() => {
        const result = answer(frame)
        if (result !== undefined && !this.dead) {
          this.reply(frame.id, result)
        }
      })
    }
    return true
  })

  reply(id: string, result: unknown): void {
    this.options.onText(JSON.stringify({ id, ok: true, result, _meta: { runtimeId: 'runtime-1' } }))
  }

  /** The cell closes this phone's socket with `error` (a RelayOuterError such
   *  as 4408, which is what the cell sends when the desktop's own leg dropped). */
  fail(error: Error): void {
    this.dead = true
    this.options.onError(error)
  }

  /** Requests the desktop was asked to run on this socket, by method. */
  sent(method: string): RelayFrame[] {
    return this.frames.filter((frame) => frame.method === method)
  }
}

/** Terminal writes are accepted and a terminal subscription is acknowledged,
 *  which is what grants the phone its input lease. */
export function answerLikeDesktop(frame: RelayFrame): unknown {
  switch (frame.method) {
    case 'terminal.subscribe':
      return { type: 'subscribed' }
    case 'terminal.send':
      return { send: { accepted: true } }
    default:
      return {}
  }
}

export function resetFakeRelayLinks(): void {
  fakeRelayLinks.length = 0
  fakeRelayCell.onOpen = null
}
