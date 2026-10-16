import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CcrPipelineDeps } from './ccr-session-shared'

// Which account a Claude tab's artifacts are listed under (use-claude-tab-account.ts): the matched
// one, else the config dir's, else the only one signed in, and nobody's with several.

const facts = vi.hoisted(() => ({ matched: null as string | null, bound: null as string | null, count: null as number | null }))
vi.mock('./ccr-session-cache', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ccrAccountForTab: () => facts.matched,
  ccrAccountForConfigDir: () => facts.bound
}))
vi.mock('./ccr-session-usage', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ccrSignedInAccountCount: () => facts.count,
  subscribeCcrUsage: () => () => undefined,
  ccrUsageVersion: () => 0
}))

import { useClaudeTabAccount, type ClaudeTabAccountScope } from './use-claude-tab-account'

const SCOPE: ClaudeTabAccountScope = { tabId: 'tab', epoch: 1, agentSessionId: 's', configDir: '/home/me/.claude' }
const signedIn = (...ids: string[]) => async () => ({ accounts: { list: async () => ids.map((id) => ({ id })) } }) as unknown as CcrPipelineDeps

let renderer: ReactTestRenderer | null = null
let seen: string | null | undefined
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  Object.assign(facts, { matched: null, bound: null, count: null })
  vi.restoreAllMocks()
})

function Probe({ scope, load }: { scope: ClaudeTabAccountScope | null; load: () => Promise<CcrPipelineDeps> }) {
  seen = useClaudeTabAccount(scope, load)
  return null
}
async function read(scope: ClaudeTabAccountScope | null, load: () => Promise<CcrPipelineDeps>): Promise<string | null | undefined> {
  seen = undefined
  await act(async () => {
    renderer = create(<Probe scope={scope} load={load} />)
  })
  return seen
}

describe("a Claude tab's artifact account", () => {
  it('is the account its session is matched to', async () => {
    facts.matched = 'work'
    facts.count = 2
    expect(await read(SCOPE, signedIn('work', 'home'))).toBe('work')
  })

  it("is its config dir's account before a match", async () => {
    facts.bound = 'home'
    expect(await read(SCOPE, signedIn('work', 'home'))).toBe('home')
  })

  it('is the only account signed in when none is named', async () => {
    facts.count = 1
    expect(await read(SCOPE, signedIn('only'))).toBe('only')
  })

  it('is nobody with several signed in and none named', async () => {
    facts.count = 2
    const load = vi.fn(signedIn('work', 'home'))
    expect(await read(SCOPE, load)).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('is nobody, and says why, when the sign-ins cannot be read', async () => {
    facts.count = 1
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await read(SCOPE, async () => {
      throw new Error('keystore locked')
    })).toBeNull()
    expect(warn).toHaveBeenCalledWith('[artifacts] the signed-in account could not be read: keystore locked')
  })

  it('is nobody on a tab with no scope (not a Claude tab)', async () => {
    facts.count = 1
    expect(await read(null, signedIn('only'))).toBeNull()
  })
})
