import { settingsRead } from '../transport/settings-read-operations'
import { decodeAccountsSnapshot, type AccountsSnapshot } from '../components/AccountUsage'
import type { HomeStatsRow } from '../stats/home-stats-total'
import { taskLinearStatusRead, taskPreflightRead } from '../tasks/mobile-task-runtime-operations'
import {
  filterAvailableTaskProviders,
  normalizeVisibleTaskProviders
} from '../tasks/mobile-task-providers'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { TASK_SOURCES_READ_FAILED, type HomeTaskSources } from './home-task-sources'
import { homeHostAccountsRead, homeHostStatsRead } from './mobile-home-host-operations'

type HomeTaskSettings = {
  visibleTaskProviders?: unknown
}

export type HomeStatsSetter = (
  updater: (previous: Record<string, HomeStatsRow>) => Record<string, HomeStatsRow>
) => void

export type HomeAccountsSetter = (
  updater: (previous: Record<string, AccountsSnapshot>) => Record<string, AccountsSnapshot>
) => void

export type HomeTaskProvidersSetter = (
  updater: (previous: Record<string, HomeTaskSources>) => Record<string, HomeTaskSources>
) => void

/** Which read the desktop refused, and the reason it gave, for the one line a refusal leaves. */
function refusedHomeRead(method: string, reply: RpcResponse) {
  return reply.ok
    ? { method, code: 'not-accepted' }
    : { method, code: reply.error.code, message: reply.error.message }
}

function failureCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The counts and accounts cards are decorative: a failed read keeps what the card showed. It still
// leaves one line naming the read and why, so a card stuck on old figures says where to look.
export function fetchMobileHomeStats(
  client: RpcClient,
  hostId: string,
  setStats: HomeStatsSetter,
  disposed: () => boolean
): void {
  const method = homeHostStatsRead.operation.method
  homeHostStatsRead
    .requestSingleFlight(client, hostId)
    .then((reply) => {
      const summary = homeHostStatsRead.interpret(reply)
      if (!summary.accepted) {
        console.warn('[home] the desktop refused its counts read', {
          hostId,
          refused: refusedHomeRead(method, reply)
        })
        return
      }
      if (!disposed()) {
        setStats((previous) => ({ ...previous, [hostId]: summary.value }))
      }
    })
    .catch((error: unknown) => {
      console.warn('[home] the counts read for this desktop failed', {
        hostId,
        method,
        cause: failureCause(error)
      })
    })
}

export function fetchMobileHomeAccounts(
  client: RpcClient,
  hostId: string,
  setSnapshots: HomeAccountsSetter,
  disposed: () => boolean
): void {
  const method = homeHostAccountsRead.operation.method
  homeHostAccountsRead
    .requestSingleFlight(client, hostId)
    .then((reply) => {
      const accounts = homeHostAccountsRead.interpret(reply)
      if (!accounts.accepted) {
        console.warn('[home] the desktop refused its accounts read', {
          hostId,
          refused: refusedHomeRead(method, reply)
        })
        return
      }
      if (!disposed()) {
        const snapshot = decodeAccountsSnapshot(accounts.value)
        setSnapshots((previous) => ({ ...previous, [hostId]: snapshot }))
      }
    })
    .catch((error: unknown) => {
      console.warn('[home] the accounts read for this desktop failed', {
        hostId,
        method,
        cause: failureCause(error)
      })
    })
}

export function fetchMobileHomeTaskProviders(
  client: RpcClient,
  hostId: string,
  setProviders: HomeTaskProvidersSetter,
  disposed: () => boolean
): void {
  // A read that ended without an answer says so, unless an earlier read found the sources: those
  // stay, since a failed read is no evidence they changed. The next focus or new connection reads
  // again either way.
  const markFailed = (): void => {
    if (disposed()) {
      return
    }
    setProviders((previous) =>
      Array.isArray(previous[hostId])
        ? previous
        : { ...previous, [hostId]: TASK_SOURCES_READ_FAILED }
    )
  }
  Promise.all([
    settingsRead.requestSingleFlight(client, hostId),
    taskPreflightRead.requestSingleFlight(client, hostId),
    taskLinearStatusRead.requestSingleFlight(client, hostId)
  ])
    .then(([settingsResponse, preflightResponse, linearResponse]) => {
      if (disposed()) {
        return
      }
      const settingsResult = settingsRead.interpret(settingsResponse)
      const preflightResult = taskPreflightRead.interpret(preflightResponse)
      const linearResult = taskLinearStatusRead.interpret(linearResponse)
      if (!settingsResult.accepted || !preflightResult.accepted || !linearResult.accepted) {
        // An { ok:false } answer says nothing about which sources the desktop has. Reading it as
        // "none" let GitHub, which needs no setup, stand in for the answer, and a refused Linear
        // or tooling check dropped a source the desktop does have (review round 2, 2026-09-30).
        // So the whole round is a failed read, exactly like a dropped link below: never "not
        // read yet", which the card draws as a check still running (review round 3).
        const refused = [
          [settingsRead.operation.method, settingsResult.accepted, settingsResponse] as const,
          [taskPreflightRead.operation.method, preflightResult.accepted, preflightResponse] as const,
          [taskLinearStatusRead.operation.method, linearResult.accepted, linearResponse] as const
        ]
          .filter(([, accepted]) => !accepted)
          .map(([method, , reply]) => refusedHomeRead(method, reply))
        console.warn('[home] the desktop refused a task source read, so its sources are unknown', {
          hostId,
          refused
        })
        markFailed()
        return
      }
      const settings =
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Preserve the established response shape at this boundary.
        (settingsResult.value ?? {}) as HomeTaskSettings
      const providers = filterAvailableTaskProviders(
        normalizeVisibleTaskProviders(settings.visibleTaskProviders),
        {
          gitlabInstalled: preflightResult.value?.glab?.installed === true,
          linearConnected: linearResult.value?.connected === true
        }
      )
      setProviders((previous) => ({ ...previous, [hostId]: providers }))
    })
    .catch((error: unknown) => {
      // Marked failed, or left at what the last read found: the card says the read failed rather
      // than claiming GitHub or a check still running, and the next focus or new connection reads
      // again (review rounds 1 and 3, 2026-09-30).
      console.warn('[home] the task sources for this desktop could not be read', {
        hostId,
        cause: failureCause(error)
      })
      markFailed()
    })
}
