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

export async function loadMobileNewTabAgentOptions(args: {
  client: RpcClient
  worktreeId: string
}): Promise<MobileNewTabAgentOption[]> {
  const { client, worktreeId } = args
  // Started before the settings read, not inside the array: the detection request goes on the wire
  // first, and the recorded sender order is what says so.
  const detectedAgentsRequest = loadDetectedAgents(client, worktreeId)
  const [settingsResponse, detectedAgents] = await Promise.all([
    newTabSettingsRead.request(client),
    detectedAgentsRequest
  ])
  const readSettings = newTabSettingsRead.interpret(settingsResponse)
  // Interpreted after the group, not inside it: whichever peer failed first must not decide the
  // error the sheet shows, and main raised the detection refusal only once settings had settled.
  const detected = detectedAgents.interpret(detectedAgents.reply)
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
  worktreeId: string
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
  const connectionId = repo.connectionId?.trim() || null
  return connectionId
    ? {
        reply: await preflightDetectRemoteAgentsRead.request(client, { connectionId }),
        interpret: preflightDetectRemoteAgentsRead.interpret
      }
    : {
        reply: await preflightDetectAgentsRead.request(client),
        interpret: preflightDetectAgentsRead.interpret
      }
}
