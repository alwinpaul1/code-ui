import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which account an artifact opens as, and that its claude.ai session is in the WebView's jar
 * before the page may load (reported 2026-10-17: signed in under Settings, and the viewer showed
 * claude.ai's "Sign in to view this page" with no way forward).
 */

const fake = vi.hoisted(() => {
  const state = { stored: new Set<string>(), jar: null as string | null, last: null as string | null, order: [] as string[] }
  const native = {
    seedClaudeSession: vi.fn(async (accountId: string) => {
      state.order.push(`seed:${accountId}`)
      state.jar = state.stored.has(accountId) ? accountId : null
      return state.stored.has(accountId)
    }),
    lastClaudeSessionAccount: vi.fn(async () => state.last)
  }
  return { state, native }
})
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: (name: string) => (name === 'OrcaClaudeSession' ? fake.native : null)
}))

import type { CcrPipelineDeps } from './ccr-session-shared'
import { setClaudeArtifactListDepsForTests } from './claude-artifact-list-store'
import { notifyAnthropicAccountsChanged } from '../dictation/anthropic-accounts-events'
import { resolveArtifactViewerAccount, useArtifactViewerSession, type ArtifactViewerSession } from './use-artifact-viewer-session'

const PERSONAL = { id: 'acct-personal', label: 'Account 1' }
const WORK = { id: 'acct-work', label: 'NexDash' }

function signIns(accounts: { id: string; label: string }[]): void {
  setClaudeArtifactListDepsForTests({
    load: async () => ({ accounts: { list: async () => accounts.map((account) => ({ ...account, accessToken: 'tok', organizationUuid: 'org' })) } }) as unknown as CcrPipelineDeps
  })
}

let renderer: ReactTestRenderer | null = null
const seen: { current: { session: ArtifactViewerSession; choose: (id: string) => void } | null } = { current: null }
function Probe({ requested }: { requested: string | null }) {
  seen.current = useArtifactViewerSession(requested)
  return null
}
const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve()
    }
  })
async function mount(requested: string | null) {
  await act(async () => {
    renderer = create(<Probe requested={requested} />)
  })
  await settle()
}

beforeEach(() => {
  fake.state.stored = new Set()
  fake.state.jar = null
  fake.state.last = null
  fake.state.order = []
  fake.native.seedClaudeSession.mockClear()
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  seen.current = null
  setClaudeArtifactListDepsForTests(null)
})

describe('resolving the account an artifact opens as', () => {
  it('takes the account the opener named while it is signed in', () => {
    expect(resolveArtifactViewerAccount('acct-work', [PERSONAL, WORK], 'acct-personal')).toBe('acct-work')
  })
  it('takes the only account when the opener named none, or one since signed out', () => {
    expect(resolveArtifactViewerAccount(null, [WORK], null)).toBe('acct-work')
    expect(resolveArtifactViewerAccount('acct-gone', [WORK], null)).toBe('acct-work')
  })
  it('takes the last account used with several and none named', () => {
    expect(resolveArtifactViewerAccount(null, [PERSONAL, WORK], 'acct-work')).toBe('acct-work')
  })
  it('takes none with several, none named and no last one (or a last one since signed out)', () => {
    expect(resolveArtifactViewerAccount(null, [PERSONAL, WORK], null)).toBeNull()
    expect(resolveArtifactViewerAccount(null, [PERSONAL, WORK], 'acct-gone')).toBeNull()
  })
  it('takes none with nobody signed in, whatever was named', () => {
    expect(resolveArtifactViewerAccount('acct-work', [], 'acct-work')).toBeNull()
  })
})

describe('the viewer session', () => {
  it('opens an artifact signed in as the account that owns it: its session is seeded before the page may load', async () => {
    signIns([PERSONAL, WORK])
    fake.state.stored = new Set(['acct-personal', 'acct-work'])
    act(() => {
      renderer = create(<Probe requested="acct-work" />)
    })
    // Until the seed is in, nothing may load.
    expect(seen.current!.session.kind).toBe('checking')
    await settle()
    expect(fake.state.order).toEqual(['seed:acct-work'])
    expect(fake.state.jar).toBe('acct-work')
    expect(seen.current!.session).toEqual({ kind: 'ready', accountId: 'acct-work' })
  })

  it('seeds the new account, replacing the old, when the viewer is opened for another', async () => {
    signIns([PERSONAL, WORK])
    fake.state.stored = new Set(['acct-personal', 'acct-work'])
    await mount('acct-personal')
    await act(async () => renderer!.update(<Probe requested="acct-work" />))
    await settle()
    expect(fake.state.order).toEqual(['seed:acct-personal', 'seed:acct-work'])
    expect(fake.state.jar).toBe('acct-work')
    expect(seen.current!.session).toEqual({ kind: 'ready', accountId: 'acct-work' })
  })

  it("asks for a sign-in, naming the account, when nothing is stored for it, instead of loading claude.ai's dead page", async () => {
    signIns([PERSONAL, WORK])
    await mount('acct-work')
    expect(seen.current!.session).toEqual({ kind: 'needed', accountId: 'acct-work', label: 'NexDash', choices: [PERSONAL, WORK] })
  })

  it('opens by itself once a sign-in is stored for the account (the user came back from signing in)', async () => {
    signIns([WORK])
    await mount(null)
    expect(seen.current!.session.kind).toBe('needed')
    fake.state.stored.add('acct-work')
    notifyAnthropicAccountsChanged({})
    await settle()
    expect(seen.current!.session).toEqual({ kind: 'ready', accountId: 'acct-work' })
  })

  it('offers the accounts to pick from with several and none known, and opens as the one picked', async () => {
    signIns([PERSONAL, WORK])
    fake.state.stored = new Set(['acct-personal'])
    await mount(null)
    expect(seen.current!.session).toEqual({ kind: 'needed', accountId: null, label: null, choices: [PERSONAL, WORK] })
    expect(fake.native.seedClaudeSession).not.toHaveBeenCalled()
    await act(async () => seen.current!.choose('acct-personal'))
    await settle()
    expect(seen.current!.session).toEqual({ kind: 'ready', accountId: 'acct-personal' })
  })

  it('with nobody signed in to Code UI, asks for a sign-in with nothing to pick', async () => {
    signIns([])
    await mount(null)
    expect(seen.current!.session).toEqual({ kind: 'needed', accountId: null, label: null, choices: [] })
  })

  it('still loads the page, as claude.ai answers it, when the module fails to seed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    signIns([WORK])
    fake.native.seedClaudeSession.mockRejectedValueOnce(new Error('CookieManager gone'))
    await mount('acct-work')
    expect(seen.current!.session).toEqual({ kind: 'ready', accountId: 'acct-work' })
  })
})
