import {
  PREFLIGHT_OTHER_RUNTIME_REFUSAL_RUNTIME_CAPABILITY,
  WORKSPACE_ON_OTHER_RUNTIME
} from '../../../src/shared/protocol-version'
import { newTabSettingsRead } from '../transport/settings-read-operations'
import {
  type MobileRuntimeRepoSummary,
  newTabRepoListRead,
  preflightDetectAgentsRead,
  preflightDetectRemoteAgentsRead
} from './mobile-session-read-operations'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { isFloatingWorkspaceWorktreeId } from './floating-workspace'
import { getRepoIdFromMobileWorktreeId } from './mobile-session-route-helpers'
import {
  buildMobileNewTabAgentOptions,
  type MobileNewTabAgentOption,
  type MobileNewTabAgentSettings
} from './mobile-new-tab-agent-options'

const FOLDER_WORKSPACE_REPO_PREFIX = 'folder-workspace:'

export function isFolderWorkspaceWorktreeId(worktreeId: string): boolean {
  return getRepoIdFromMobileWorktreeId(worktreeId).startsWith(FOLDER_WORKSPACE_REPO_PREFIX)
}

const WORKSPACE_ON_OTHER_RUNTIME_MESSAGE =
  'This workspace runs on another Orca server. Pair that server directly to see its agents.'

/** The paired host does not own this workspace, so its agents are unverifiable from here (Orca
 *  #27196). */
export class MobileWorkspaceOnOtherRuntimeError extends Error {
  constructor() {
    super(WORKSPACE_ON_OTHER_RUNTIME_MESSAGE)
    this.name = 'MobileWorkspaceOnOtherRuntimeError'
  }
}

export function hostRefusesOtherRuntimeWorkspace(
  hostCapabilities: readonly string[] | null | undefined
): boolean {
  return hostCapabilities?.includes(PREFLIGHT_OTHER_RUNTIME_REFUSAL_RUNTIME_CAPABILITY) === true
}

export async function loadMobileNewTabAgentOptions(args: {
  client: RpcClient
  worktreeId: string
  /** Whether the host refuses, rather than answers for, a workspace another runtime owns. */
  hostRefusesOtherRuntime?: boolean
}): Promise<MobileNewTabAgentOption[]> {
  const { client, worktreeId } = args
  // Started before the settings read, not inside the array: the detection request goes on the wire
  // first, and the recorded sender order is what says so.
  const detectedAgentsRequest = loadDetectedAgents(client, worktreeId, args.hostRefusesOtherRuntime)
  const [settingsResponse, detectedAgents] = await Promise.all([
    newTabSettingsRead.request(client),
    detectedAgentsRequest
  ])
  const readSettings = newTabSettingsRead.interpret(settingsResponse)
  // Interpreted after the group, not inside it: whichever peer failed first must not decide the
  // error the sheet shows, and main raised the detection refusal only once settings had settled.
  const detected = interpretDetectedAgents(detectedAgents)
  return buildMobileNewTabAgentOptions(
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Preserve the established response shape at this boundary.
    readSettings() as MobileNewTabAgentSettings | undefined,
    detected
  )
}

/** The reply and the operation that reads it: two methods detect agents and each reads its own. */
type DetectedAgentsReply = {
  reply: RpcResponse
  interpret: (reply: RpcResponse) => unknown[]
}

async function loadDetectedAgents(
  client: RpcClient,
  worktreeId: string,
  hostRefusesOtherRuntime = false
): Promise<DetectedAgentsReply> {
  // Why: the floating workspace and folder workspaces run on the paired host and
  // have no repo to resolve — a folder workspace's `folder-workspace:<group>`
  // repo id is never in repo.list, and the old lookup threw
  // worktree_repo_not_found, which the drawer showed as "Agent Presets
  // Unavailable — check the host connection" (Orca issue #16215).
  if (isFloatingWorkspaceWorktreeId(worktreeId) || isFolderWorkspaceWorktreeId(worktreeId)) {
    return {
      reply: await preflightDetectAgentsRead.request(client),
      interpret: preflightDetectAgentsRead.interpret
    }
  }
  const repoResponse = await newTabRepoListRead.request(client)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Preserve the established response shape at this boundary.
  const repos = (newTabRepoListRead.interpret(repoResponse) as MobileRuntimeRepoSummary[]) ?? []
  const repoId = getRepoIdFromMobileWorktreeId(worktreeId)
  const repo = repos.find((candidate) => candidate.id === repoId)
  if (!repo) {
    throw new Error('worktree_repo_not_found')
  }
  // Orca #27196. A prefix test, as upstream's (parseExecutionHostId would split a web chunk there).
  const runtimeOwned = repos
    .filter((candidate) => candidate.id === repoId)
    .map((candidate) => {
      const host: unknown = candidate.executionHostId
      return typeof host === 'string' && host.startsWith('runtime:')
    })
  if (runtimeOwned.includes(true)) {
    // Why: rows on several hosts can share a repo id, and then only a host that refuses another
    // runtime's workspace may decide; the first row's connection could name this host's SSH target.
    if (!hostRefusesOtherRuntime || !runtimeOwned.includes(false)) {
      throw new MobileWorkspaceOnOtherRuntimeError()
    }
    return {
      reply: await preflightDetectAgentsRead.request(client, { worktreeId }),
      interpret: preflightDetectAgentsRead.interpret
    }
  }
  const connectionId = repo.connectionId?.trim() || null
  return connectionId
    ? {
        reply: await preflightDetectRemoteAgentsRead.request(client, { connectionId }),
        interpret: preflightDetectRemoteAgentsRead.interpret
      }
    : {
        // Why the workspace (Orca #27054): the host resolves its project runtime (a WSL distro on
        // Windows). An older host discards the params and answers with its own default, as it
        // always has.
        reply: await preflightDetectAgentsRead.request(client, { worktreeId }),
        interpret: preflightDetectAgentsRead.interpret
      }
}

function interpretDetectedAgents(detected: DetectedAgentsReply): unknown[] {
  try {
    return detected.interpret(detected.reply)
  } catch (error) {
    // A host with the refusal answers it for a workspace another runtime owns.
    if (error instanceof Error && error.message === WORKSPACE_ON_OTHER_RUNTIME) {
      throw new MobileWorkspaceOnOtherRuntimeError()
    }
    throw error
  }
}
