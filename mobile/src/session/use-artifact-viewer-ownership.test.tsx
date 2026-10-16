import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setClaudeArtifactListDepsForTests } from './claude-artifact-list-store'
import type { CcrFetch } from './ccr-session-api'
import type { CcrPipelineDeps } from './ccr-session-shared'
import { PUBLISHED_UUID } from './fixtures/claude-artifact-tool-2.1.301'
import { useArtifactViewerOwnsArtifact } from './use-artifact-viewer-ownership'

// Whose artifact the viewer shows decides Share and Add to home screen against Open in browser
// (sq30.java:4155-4290). The viewer has no tab, so only the one signed-in account can claim it.

const OTHER_UUID = '00000000-0000-4000-8000-000000000001'

function pipeline(accounts: string[], frames: unknown[], failAccounts = false): CcrPipelineDeps {
  const fetchImpl: CcrFetch = async () => ({ ok: true, status: 200, json: async () => ({ frames }) })
  return {
    fetch: fetchImpl,
    accounts: {
      list: async (only?: string) => {
        if (failAccounts) {
          throw new Error('keystore locked')
        }
        return accounts
          .filter((id) => only === undefined || only === id)
          .map((id) => ({ id, label: id, accessToken: 'tok', organizationUuid: 'org' }))
      },
      rememberProfile: async () => null,
      forgetOrganization: async () => undefined
    },
    keep: () => '',
    maxBytes: 0
  } as unknown as CcrPipelineDeps
}

let renderer: ReactTestRenderer | null = null
const seen: boolean[] = []
function Probe({ uuid }: { uuid: string }) {
  seen.push(useArtifactViewerOwnsArtifact(uuid))
  return null
}
async function settle(uuid = PUBLISHED_UUID): Promise<boolean> {
  await act(async () => {
    renderer = create(<Probe uuid={uuid} />)
  })
  // The accounts, then the list, each answer on a later turn.
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  return seen[seen.length - 1]!
}

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  seen.length = 0
  setClaudeArtifactListDepsForTests(null)
  vi.restoreAllMocks()
})

describe("whether the viewer's artifact is the user's own", () => {
  it("is, when the one signed-in account's list holds it as mine (in any case)", async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(['acct'], [{ slug: PUBLISHED_UUID, title: 'T', rel: 'mine' }]) })
    expect(await settle(PUBLISHED_UUID.toUpperCase())).toBe(true)
    // Not before the list has answered.
    expect(seen[0]).toBe(false)
  })

  it('is not, when the list holds it as shared with the account', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(['acct'], [{ slug: PUBLISHED_UUID, title: 'T', rel: 'shared' }]) })
    expect(await settle()).toBe(false)
  })

  it('is not, when the list does not hold it, or holds nothing', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(['acct'], [{ slug: OTHER_UUID, title: 'T', rel: 'mine' }]) })
    expect(await settle()).toBe(false)
    act(() => renderer?.unmount())
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(['acct'], []) })
    expect(await settle()).toBe(false)
  })

  it('is not, with no account signed in', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline([], [{ slug: PUBLISHED_UUID, title: 'T', rel: 'mine' }]) })
    expect(await settle()).toBe(false)
  })

  it('is not, with two accounts signed in, since the viewer cannot tell whose it is', async () => {
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(['work', 'home'], [{ slug: PUBLISHED_UUID, title: 'T', rel: 'mine' }]) })
    expect(await settle()).toBe(false)
  })

  it('is not, and says why, when the sign-ins cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setClaudeArtifactListDepsForTests({ load: async () => pipeline(['acct'], [{ slug: PUBLISHED_UUID, title: 'T', rel: 'mine' }], true) })
    expect(await settle()).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('keystore locked'))
  })
})
