import { nativeChatAgentFromTranscriptPath } from './mobile-native-chat-session-agent'

/**
 * Whether a Claude session works in the Orca worktree its tab belongs to, read off the transcript
 * path the agent's hook reported. Nothing else on the phone says where the agent is: Orca's tab
 * carries the worktree it was opened in, not the directory the agent was started in, and a hand-run
 * `cd elsewhere && claude --resume` lives in the tab of one checkout while it works in another
 * (reported 2026-10-15: the NexOS tab's agent worked in NexOS-Mobile-wt/tablet-cab-redesign).
 *
 * Claude Code names a session's project folder after its working directory: every character that
 * is not a letter or a digit becomes `-`, and a name over 200 characters is cut to 200 and given
 * `-<hash>` (Claude Code 2.1.300, `j0`/`N` in the binary). The match is exact, so a session in a
 * subfolder of the worktree counts as elsewhere: its pills would be the worktree's guess.
 *
 * - `here`: the transcript's folder is the worktree's;
 * - `elsewhere`: it is a Claude transcript in another folder;
 * - `unknown`: no Claude transcript path, or no worktree path, says either way.
 */
export type AgentWorktreePlace = 'here' | 'elsewhere' | 'unknown'

const PROJECT_DIR_MAX = 200

export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function agentWorksInWorktree(transcriptPath: string | null | undefined, worktreePath: string | null): AgentWorktreePlace {
  if (!transcriptPath || !worktreePath || nativeChatAgentFromTranscriptPath(transcriptPath) !== 'claude') {
    return 'unknown'
  }
  const parts = transcriptPath.replace(/\\/g, '/').split('/')
  const projectDir = parts[parts.length - 2]
  if (!projectDir) {
    return 'unknown'
  }
  const expected = claudeProjectDirName(worktreePath)
  if (expected.length <= PROJECT_DIR_MAX) {
    return projectDir === expected ? 'here' : 'elsewhere'
  }
  // The hash is Claude Code's own and not recomputed here: the cut name and a hash-shaped tail.
  const cut = expected.slice(0, PROJECT_DIR_MAX)
  return projectDir.startsWith(`${cut}-`) && /^[0-9a-z]+$/.test(projectDir.slice(cut.length + 1)) ? 'here' : 'elsewhere'
}
