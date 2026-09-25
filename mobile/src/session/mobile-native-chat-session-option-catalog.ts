import {
  getAgentSessionOptionCatalog,
  type CatalogModel
} from '../../../src/shared/agent-session-option-catalog'
import type {
  AgentSessionOptionCatalog,
  CatalogOptionApply
} from '../../../src/shared/agent-session-option-catalog-types'
import { withRunningClaudeModelEfforts } from './claude-running-model-efforts'
import { mobileEffortNamedCatalog } from './mobile-claude-session-catalog'
import { mobileOmpSessionCatalog } from './mobile-omp-session-catalog'

/** The catalog the phone's model sheet lists for an agent, or null for an agent
 *  it has none for. */
export function mobileNativeChatSessionOptionCatalog(args: {
  agent: string | null
  /** Models the host discovered for this agent, replacing the static seed. */
  discoveredModels?: readonly CatalogModel[] | null
  discoveredModelApply?: CatalogOptionApply | null
  modelSwitchCommand?: string
  /** Claude only: the model the session reports, and the agent's own name for
   *  it, so that row offers only the levels Claude Code allows it. */
  runningModel: string | null
  runningModelLabel: string | null
}): AgentSessionOptionCatalog | null {
  const { agent, discoveredModels, discoveredModelApply } = args
  // Widening this to a `defaultModelIsCliDefault` catalog (grok) also needs the
  // effective-model resolution desktop does — `previousModelId` in the options
  // hook is tracked-only, so a CLI-default model would render option rows that
  // do nothing when tapped.
  const base =
    agent === 'claude' || agent === 'codex' || agent === 'omp'
      ? getAgentSessionOptionCatalog(agent)
      : null
  if (!base) {
    return null
  }
  if (agent === 'omp') {
    // OMP seeds no models: the list is whatever the host discovered, and a
    // switch is offered only where the running extension installed the
    // command for it (Orca #20612).
    return mobileOmpSessionCatalog(base, discoveredModels, args.modelSwitchCommand)
  }
  const merged =
    discoveredModels && discoveredModels.length > 0
      ? {
          ...base,
          models: [...discoveredModels],
          ...(discoveredModelApply ? { modelApply: discoveredModelApply } : {})
        }
      : base
  // The Claude app's effort names, and its Ultracode on Claude alone
  // (mobile-claude-session-catalog.ts). Claude's running row is cut to what
  // Claude Code allows it first, so Ultracode follows the xhigh that is left.
  return agent === 'claude'
    ? mobileEffortNamedCatalog(
        withRunningClaudeModelEfforts(merged, args.runningModel, args.runningModelLabel),
        { ultracode: true }
      )
    : mobileEffortNamedCatalog(merged, { ultracode: false })
}
