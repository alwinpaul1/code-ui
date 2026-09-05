import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcSuccess } from '../transport/types'
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

type RuntimeRepoSummary = {
  id: string
  connectionId?: string | null
}

export async function loadMobileNewTabAgentOptions(args: {
  client: RpcClient
  worktreeId: string
}): Promise<MobileNewTabAgentOption[]> {
  const { client, worktreeId } = args
  // Why: the floating workspace and folder workspaces run on the paired host and
  // have no repo to resolve — a folder workspace's `folder-workspace:<group>`
  // repo id is never in repo.list, and the old lookup threw
  // worktree_repo_not_found, which the drawer showed as "Agent Presets
  // Unavailable — check the host connection" (Orca issue #16215).
  const detectedAgentsRequest =
    isFloatingWorkspaceWorktreeId(worktreeId) || isFolderWorkspaceWorktreeId(worktreeId)
      ? client.sendRequest('preflight.detectAgents')
      : loadWorkspaceDetectedAgents(client, worktreeId)
  const [settingsResponse, detectedResponse] = await Promise.all([
    client.sendRequest('settings.get'),
    detectedAgentsRequest
  ])
  if (!settingsResponse.ok) {
    throw new Error((settingsResponse as RpcFailure).error.message)
  }
  if (!detectedResponse.ok) {
    throw new Error((detectedResponse as RpcFailure).error.message)
  }
  const settings = (
    (settingsResponse as RpcSuccess).result as {
      settings?: MobileNewTabAgentSettings
    }
  ).settings
  return buildMobileNewTabAgentOptions(
    settings,
    (detectedResponse as RpcSuccess).result as unknown[]
  )
}

async function loadWorkspaceDetectedAgents(client: RpcClient, worktreeId: string) {
  const repoResponse = await client.sendRequest('repo.list')
  if (!repoResponse.ok) {
    throw new Error((repoResponse as RpcFailure).error.message)
  }
  const repoId = getRepoIdFromMobileWorktreeId(worktreeId)
  const repos =
    ((repoResponse as RpcSuccess).result as { repos?: RuntimeRepoSummary[] }).repos ?? []
  const repo = repos.find((candidate) => candidate.id === repoId)
  if (!repo) {
    throw new Error('worktree_repo_not_found')
  }
  const connectionId = repo.connectionId?.trim() || null
  return connectionId
    ? client.sendRequest('preflight.detectRemoteAgents', { connectionId })
    : client.sendRequest('preflight.detectAgents')
}
