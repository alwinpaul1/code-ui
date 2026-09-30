// The session's PR repo probe (useMobilePrBranchContext) after one failed probe on a connection
// that STAYS UP.
//
// Round 3 stopped a failed github.repoSlug from claiming "not GitHub" and left repoLoaded false.
// The session header's PR entry and checks action need repoLoaded && isGithubRepo, and the probe
// only ran again when `ready` flipped. One relay timeout on a link that stayed connected (a
// LAN->relay migration keeps connState 'connected') hid the PR entry for the rest of the visit,
// with nothing on screen to say a check had failed (review round 3, 2026-09-30).
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import {
  PR_REPO_PROBE_RETRY_DELAYS_MS,
  useMobilePrBranchContext,
  type MobilePrBranchContext
} from './use-mobile-pr-branch-context'

let captured: MobilePrBranchContext | null = null

type HarnessProps = {
  client: RpcClient
  connState: ConnectionState
  lastConnectedAt: number | null
  includeBranchIdentity: boolean
}

function Harness(props: HarnessProps) {
  captured = useMobilePrBranchContext({ ...props, worktreeId: 'repo::/wt' })
  return null
}

const GITHUB = { id: 'r', ok: true, result: { owner: 'stablyai', repo: 'orca' } }
const STATUS = {
  id: 'r',
  ok: true,
  result: { entries: [], conflictOperation: 'unknown', branch: 'feat', head: 'sha-status' }
}
const timedOut = () => Promise.reject(new Error('Request timed out: github.repoSlug'))
const refused = async () => ({
  id: 'r',
  ok: false,
  error: { code: 'runtime_timeout', message: 'runtime_timeout' }
})

/** A connected host whose github.repoSlug answers come from `slug`, one per probe. */
function host(slug: (() => Promise<unknown>)[]) {
  const probes = vi.fn()
  const statusReads = vi.fn()
  const sendRequest = vi.fn(async (method: string) => {
    if (method === 'github.repoSlug') {
      probes()
      const next = slug.length > 1 ? slug.shift()! : slug[0]!
      return next()
    }
    if (method === 'git.status') {
      statusReads()
      return STATUS
    }
    // No repo base ref: branchCompare is skipped, and headSha comes from git.status.
    if (method === 'repo.list') {
      return { id: 'r', ok: true, result: { repos: [] } }
    }
    return { id: 'r', ok: false, error: { code: 'unexpected', message: `unexpected ${method}` } }
  })
  return {
    client: { sendRequest } as unknown as RpcClient,
    probes: () => probes.mock.calls.length,
    statusReads: () => statusReads.mock.calls.length
  }
}

let renderer: ReactTestRenderer | null = null

async function mount(props: HarnessProps): Promise<void> {
  await act(async () => {
    renderer = create(createElement(Harness, props))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function update(props: HarnessProps): Promise<void> {
  await act(async () => {
    renderer!.update(createElement(Harness, props))
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Every backoff in turn, each in its own act so the retry it schedules renders before the next. */
async function waitThroughEveryRetry(): Promise<void> {
  for (const delay of PR_REPO_PROBE_RETRY_DELAYS_MS) {
    await wait(delay)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  captured = null
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the session PR repo probe after a failed probe on a connection that stays up', () => {
  it.each([
    ['times out', timedOut],
    ['is refused', refused]
  ])(
    'shows the PR entry once a later try answers, without a reconnect, when the probe %s (repo only)',
    async (_case, failure) => {
      const desktop = host([failure, async () => GITHUB])
      await mount({
        client: desktop.client,
        connState: 'connected',
        lastConnectedAt: 1,
        includeBranchIdentity: false
      })
      expect(captured?.repoLoaded).toBe(false)

      await wait(PR_REPO_PROBE_RETRY_DELAYS_MS[0])
      expect(desktop.probes()).toBe(2)
      expect(captured?.repoLoaded).toBe(true)
      expect(captured?.isGithubRepo).toBe(true)
      expect(captured?.loaded).toBe(true)
    }
  )

  it('keeps the branch it read while a later try answers the probe (branch identity too)', async () => {
    const desktop = host([timedOut, async () => GITHUB])
    await mount({
      client: desktop.client,
      connState: 'connected',
      lastConnectedAt: 1,
      includeBranchIdentity: true
    })
    expect(captured).toMatchObject({ branch: 'feat', headSha: 'sha-status', loaded: true })
    expect(captured?.repoLoaded).toBe(false)

    await wait(PR_REPO_PROBE_RETRY_DELAYS_MS[0])
    expect(captured).toMatchObject({
      branch: 'feat',
      headSha: 'sha-status',
      loaded: true,
      repoLoaded: true,
      isGithubRepo: true
    })
    // The probe's retry is its own: it does not read the branch again.
    expect(desktop.statusReads()).toBe(1)
  })

  it('stops after a bounded number of tries while the probe keeps failing', async () => {
    const desktop = host([timedOut])
    await mount({
      client: desktop.client,
      connState: 'connected',
      lastConnectedAt: 1,
      includeBranchIdentity: false
    })
    await waitThroughEveryRetry()
    const bounded = 1 + PR_REPO_PROBE_RETRY_DELAYS_MS.length
    expect(desktop.probes()).toBe(bounded)

    await wait(10 * 60_000)
    expect(desktop.probes()).toBe(bounded)
    expect(captured?.repoLoaded).toBe(false)
    expect(captured?.isGithubRepo).toBe(false)
  })

  it('tries again once when the connection is replaced under a steady connected state', async () => {
    const desktop = host([timedOut])
    await mount({
      client: desktop.client,
      connState: 'connected',
      lastConnectedAt: 1,
      includeBranchIdentity: false
    })
    await waitThroughEveryRetry()
    await wait(60_000)
    const before = desktop.probes()

    await update({
      client: desktop.client,
      connState: 'connected',
      lastConnectedAt: 1,
      includeBranchIdentity: false
    })
    expect(desktop.probes()).toBe(before)

    await update({
      client: desktop.client,
      connState: 'connected',
      lastConnectedAt: 2,
      includeBranchIdentity: false
    })
    expect(desktop.probes()).toBe(before + 1)
    await update({
      client: desktop.client,
      connState: 'connected',
      lastConnectedAt: 2,
      includeBranchIdentity: false
    })
    expect(desktop.probes()).toBe(before + 1)
  })

  it('shows the PR entry when the probe answers on the replaced connection', async () => {
    const desktop = host([timedOut, timedOut, timedOut, async () => GITHUB])
    await mount({
      client: desktop.client,
      connState: 'connected',
      lastConnectedAt: 1,
      includeBranchIdentity: false
    })
    await waitThroughEveryRetry()
    await wait(60_000)
    expect(captured?.repoLoaded).toBe(false)

    await update({
      client: desktop.client,
      connState: 'connected',
      lastConnectedAt: 2,
      includeBranchIdentity: false
    })
    expect(captured?.repoLoaded).toBe(true)
    expect(captured?.isGithubRepo).toBe(true)
  })

  it('does not probe again on a new connection once the probe has answered', async () => {
    const desktop = host([async () => GITHUB])
    await mount({
      client: desktop.client,
      connState: 'connected',
      lastConnectedAt: 1,
      includeBranchIdentity: false
    })
    await update({
      client: desktop.client,
      connState: 'connected',
      lastConnectedAt: 2,
      includeBranchIdentity: false
    })
    await waitThroughEveryRetry()
    expect(desktop.probes()).toBe(1)
    expect(captured?.repoLoaded).toBe(true)
  })

  it('never tries again while the host is down', async () => {
    const desktop = host([timedOut])
    await mount({
      client: desktop.client,
      connState: 'connected',
      lastConnectedAt: 1,
      includeBranchIdentity: false
    })
    await update({
      client: desktop.client,
      connState: 'reconnecting',
      lastConnectedAt: 1,
      includeBranchIdentity: false
    })
    await waitThroughEveryRetry()
    await wait(60_000)
    expect(desktop.probes()).toBe(1)
  })
})
