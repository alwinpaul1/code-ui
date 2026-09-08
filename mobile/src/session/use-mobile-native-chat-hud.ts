import type { MutableRefObject } from 'react'
import type { RpcClient } from '../transport/rpc-client'
import { mergeAgentHudObservation } from './agent-hud-merge'
import type { AgentHudSnapshot } from './agent-hud-snapshot'
import { useAgentHudSnapshot } from './use-agent-hud-snapshot'
import { useMobileTerminalHudObservation } from './use-mobile-terminal-hud-observation'

/** The chat HUD, from two sources with one rule: the agent's own record wins.
 *
 *  Claude Code and Codex both write the model, the effort and the context they
 *  are running with to disk, and Codex writes its rate-limit windows too. The
 *  terminal screen carries those only when the user happens to run a status
 *  line, and then as text wrapped to the pane. So the snapshot is preferred for
 *  the numbers, and the screen read stays underneath for what only it can see —
 *  a permission dialog is not in the transcript until it has been answered. */
export function useMobileNativeChatHud(args: {
  client: RpcClient | null
  enabled: boolean
  handleRef: MutableRefObject<string | null>
  scopeKey: string | null
  agent: string | null
  active: boolean
  worktreeId: string | null
  transcriptPath: string | null
  sessionId: string | null
}) {
  const screen = useMobileTerminalHudObservation({
    client: args.client,
    enabled: args.enabled,
    handleRef: args.handleRef,
    handleKey: args.scopeKey,
    agent: args.agent,
    active: args.active
  })
  const { snapshot, refresh: refreshSnapshot } = useAgentHudSnapshot({
    client: args.client,
    enabled: args.enabled,
    worktree: args.worktreeId ? `id:${args.worktreeId}` : null,
    agent: args.agent,
    transcriptPath: args.transcriptPath,
    // Codex is addressed by its session id, which is in its rollout filename.
    // Without one there is no honest way to tell two concurrent Codex sessions
    // apart, so the snapshot refuses rather than reporting the wrong one.
    sessionId: args.sessionId,
    cwd: null,
    scopeKey: args.scopeKey
  })
  return {
    ...screen,
    observation: mergeAgentHudObservation(screen.observation, snapshot),
    snapshot: snapshot as AgentHudSnapshot | null,
    /** The snapshot now outranks the screen for the model, and it only ticks
     *  every 30 s. Changing the model from the phone used to show in a second,
     *  so the caller has to be able to say "look again now". */
    refresh: async () => {
      const [observation] = await Promise.all([screen.refresh(), refreshSnapshot()])
      return observation
    }
  }
}
