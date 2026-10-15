import type { TuiAgent } from '../../../src/shared/tui-agent'
import { resolveStartupShell, tokenizeStartupCommand } from '../../../src/shared/tui-agent-startup-shell'
import { hostTakesAgentHudFlag } from './agent-hud-launch-args'

/**
 * `--remote-control` for the Claude sessions the phone starts (Claude Code 2.1.300:
 * `--remote-control [name]`, "Start an interactive session with Remote Control enabled").
 * Nothing is saved on the host: the flag rides this tab's launch config only, so turning the
 * switch off needs no clean-up and a desktop-started tab is never touched. (A bare
 * `--remote-control` the user saved themselves cannot be told from ours, so a desktop sync
 * could not take ours back out; that is why there is none.)
 *
 * Where it goes: FIRST. The flag takes an optional name, and Orca appends the prompt to the
 * args as a bare word, so a flag left last would take the prompt as the session's name. In
 * front of another flag it takes nothing. When the args do not start with a flag there is
 * nowhere safe to put it, and no flag is added.
 *
 * A Windows host, and a host that will not say what it is, get none, the same rule as the
 * beacon flag (`hostTakesAgentHudFlag`): nothing new reaches a Windows launch until a launch
 * encoding is proven there. The flag itself needs no quoting; the rule is the repo's.
 */
export function withRemoteControlFlag(args: {
  agent: TuiAgent
  agentArgs: string
  hostPlatform: NodeJS.Platform | null
  enabled: boolean
}): string {
  const { agent, agentArgs, hostPlatform, enabled } = args
  if (agent !== 'claude' || !enabled || !hostTakesAgentHudFlag(hostPlatform)) {
    return agentArgs
  }
  const tokenized = tokenizeStartupCommand(agentArgs, resolveStartupShell(hostPlatform ?? 'linux'))
  if (!tokenized.ok) {
    console.warn(`[remote-control-args] claude: no --remote-control, the args do not split (${tokenized.error})`)
    return agentArgs
  }
  if (tokenized.tokens.some((token) => token === '--remote-control' || token.startsWith('--remote-control='))) {
    return agentArgs
  }
  const trimmed = agentArgs.trim()
  if (!trimmed.startsWith('-')) {
    console.warn('[remote-control-args] claude: no --remote-control, no flag of the args to stand in front of')
    return agentArgs
  }
  return `--remote-control ${trimmed}`
}
