import {
  AGENT_LAUNCH_RUNTIME_CAPABILITY,
  AGENT_SESSION_PENDING_SEND_RESULT_RUNTIME_CAPABILITY,
  AGENT_SESSION_TURN_ITEM_CAPABILITY,
  CLAUDE_STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_HOLD_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY
} from '../../../src/shared/protocol-version'
import { remoteRuntimeClientCapabilities } from '../../../src/shared/remote-runtime-client-capabilities'

// The shared list also advertises the two background-task capabilities (Orca
// #19346, #19705): this phone draws a per-row Stop only where the roster says
// `supportsTaskStop` and never draws a stop-all, and it hides the Stop on a row
// marked `stoppable: false`. Advertising the second is what makes the host send
// foreground rows — a live subagent inside a turn — at all.
export const MOBILE_RUNTIME_CLIENT_CAPABILITIES = remoteRuntimeClientCapabilities([
  STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  // Orca #19863: the host answers agentSession.send as soon as the message is
  // written, with a `pending` submission, instead of holding the reply up to
  // 10 s for the provider's echo — an echo that cannot come until the turn
  // ahead ends. This phone never read the reply's dispatch state: an `ok`
  // is "accepted" and the journal's submission row carries the rest.
  AGENT_SESSION_PENDING_SEND_RESULT_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_HOLD_RUNTIME_CAPABILITY,
  CLAUDE_STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY,
  // Opts into the typed turn record; without it the host sends the legacy status carrier.
  AGENT_SESSION_TURN_ITEM_CAPABILITY,
  SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY,
  // Mobile renders either launch outcome — a structured chat or a terminal agent — so it may ask
  // the host to pick. Without this the host refuses `agent.launch` and every mobile create with an
  // agent stays a PTY.
  AGENT_LAUNCH_RUNTIME_CAPABILITY
])

export const MOBILE_RUNTIME_CLIENT_CAPABILITY_UPDATE_METHOD =
  'runtime.clientCapabilities.update' as const

export function mobileRuntimeClientCapabilityUpdateParams(): {
  clientCapabilities: string[]
} {
  return { clientCapabilities: [...MOBILE_RUNTIME_CLIENT_CAPABILITIES] }
}

export function mobileRuntimeClientCapabilityUpdateRequest(args: {
  id: string
  deviceToken: string
}): {
  id: string
  deviceToken: string
  method: typeof MOBILE_RUNTIME_CLIENT_CAPABILITY_UPDATE_METHOD
  params: { clientCapabilities: string[] }
} {
  return {
    id: args.id,
    deviceToken: args.deviceToken,
    method: MOBILE_RUNTIME_CLIENT_CAPABILITY_UPDATE_METHOD,
    params: mobileRuntimeClientCapabilityUpdateParams()
  }
}

export function advertiseMobileRuntimeClientCapabilities(
  send: (request: unknown) => boolean | void,
  id: string,
  deviceToken: string
): void {
  send(mobileRuntimeClientCapabilityUpdateRequest({ id, deviceToken }))
}
