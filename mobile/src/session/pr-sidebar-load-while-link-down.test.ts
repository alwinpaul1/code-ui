// A PR read issued while the link to the desktop is down.
//
// classifyPrSidebarFailure matched /\bnot connected\b/ as a permanent failure, meant for a GitHub
// account that is not connected. The phone's own transport says the same words about the socket:
// `Not connected: <method>` (rpc-client-request-tracker.ts, mobile-relay-rpc-session.ts) and
// `relay session not connected` (mobile-relay-rpc-session.ts). Such a load landed on `blocked`,
// which has no Retry, is drawn as "your GitHub account is not connected", and is not what the
// reconnect refetch keys on, so the sidebar stayed blocked after the link came back (review round
// 2, 2026-09-30).

import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { RpcClientRequestTracker } from '../transport/rpc-client-request-tracker'
import { fetchPRForBranch } from './github-pr-rpc'
import {
  classifyPrSidebarFailure,
  loadPrSidebarData,
  type PrSidebarLoadDeps
} from './mobile-pr-sidebar-state'

/** A client whose sends go through the real request tracker, on a socket that is not up. */
function clientWithLinkDown(): RpcClient {
  const tracker = new RpcClientRequestTracker({
    nextId: () => '1',
    getState: () => 'reconnecting',
    waitForConnected: () => new Promise(() => {}),
    sendEncrypted: () => false,
    deviceToken: 'device'
  })
  return {
    sendRequest: (method: string, params?: unknown) =>
      tracker.sendRequest(method, params, { failWhenDisconnected: true })
  } as unknown as RpcClient
}

function depsReading(client: RpcClient): PrSidebarLoadDeps {
  return {
    fetchForBranch: vi.fn(async () => ({ ok: true as const, result: null })),
    fetchWorktreeLinkedPR: vi.fn(async () => null),
    fetchPRForBranch: (worktreeId, args) => fetchPRForBranch(client, worktreeId, args),
    fetchWorkItemDetails: vi.fn(async () => ({ ok: true as const, result: null })),
    fetchPRChecks: vi.fn(async () => ({ ok: true as const, result: [] }))
  }
}

describe('a PR read made while the link to the desktop is down', () => {
  it('lands on a retryable error, not blocked, when the transport refuses the send', async () => {
    const state = await loadPrSidebarData(depsReading(clientWithLinkDown()), {
      worktreeId: 'repo-1::/w',
      branch: 'feat'
    })
    expect(state).toEqual({ kind: 'error', message: 'Not connected: github.prForBranch' })
  })

  it("reads the transport's own not-connected wordings as transient", () => {
    expect(classifyPrSidebarFailure('Not connected: github.prForBranch')).toBe('error')
    expect(classifyPrSidebarFailure('Not connected: github.workItemDetails')).toBe('error')
    expect(classifyPrSidebarFailure('relay session not connected')).toBe('error')
  })

  it("reads the desktop's own remote-runtime drop as transient", () => {
    // Wording from src/shared/remote-runtime-client-error-classification.ts (Orca v1.4.217).
    expect(classifyPrSidebarFailure('Remote Orca runtime is not connected.')).toBe('error')
  })

  it('still blocks a GitHub account that is not connected', () => {
    expect(classifyPrSidebarFailure('GitHub account not connected')).toBe('blocked')
    expect(classifyPrSidebarFailure('Not permitted — your GitHub account is not connected.')).toBe(
      'blocked'
    )
    expect(
      classifyPrSidebarFailure('To get started with GitHub CLI, please run:  gh auth login')
    ).toBe('blocked')
    expect(classifyPrSidebarFailure('HTTP 401: Bad credentials')).toBe('blocked')
    // A bare "not connected" names no link: it stays the account's, as before.
    expect(classifyPrSidebarFailure('not connected')).toBe('blocked')
  })

  it('reads an empty message as a retryable error', () => {
    expect(classifyPrSidebarFailure('')).toBe('error')
  })
})
