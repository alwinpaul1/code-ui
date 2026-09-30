import type { TuiAgent } from '../../../src/shared/tui-agent'
import { resolveTuiAgentLaunchArgs } from '../../../src/shared/tui-agent-launch-defaults'
import { readMobileRuntimeHostPlatform } from '../transport/mobile-runtime-host-platform'
import type { RpcClient } from '../transport/rpc-client'
import { agentHudLaunchFlag, hostTakesAgentHudFlag } from './agent-hud-launch-args'
import { readHudLaunchFlags, withoutSpans } from './agent-hud-launch-flag-owner'

/**
 * Agents started on the DESKTOP get the HUD beacon the same way the phone's
 * own launches do: through Orca's per-agent default arguments
 * (`agentDefaultArgs`), which Orca appends to every agent it launches. Orca
 * manages that field itself (its yolo mode writes it too) and lets a paired
 * phone update it over `settings.update`. So the phone puts one flag per agent
 * there and takes it away again when the switch is turned off. Nothing else on
 * the host is touched: no file of the user's, no plugin, no script.
 *
 * Nothing appears in the user's terminal either. Claude Code draws no status
 * row when the command prints nothing, and hands a user's own status line
 * straight back when they have one; Codex draws nothing for a notify command
 * at all. That is what makes this allowed, where the 0.2.77 flags — which put
 * a visible row in every terminal — were not.
 *
 * The user's own arguments are preserved in front, and ours are recognised by
 * our signature or by 0.2.77's exact text (`agent-hud-launch-flag-owner.ts`),
 * never by shape, so the write is idempotent, an upgrade replaces rather than
 * stacks, 0.2.77's flags are removed wherever they are still found, and a flag
 * of the user's that looks like ours is theirs to keep. A user who already
 * passes their own `--settings` (Claude) or `-c notify=` (Codex) gets no
 * beacon flag for that agent: ours would replace theirs.
 */
const HUD_AGENTS = ['claude', 'codex'] as const
type HudAgent = (typeof HUD_AGENTS)[number]

/** `current` less every flag of ours; exactly `current` when it holds none,
 *  or when it cannot be split the way Orca splits it. */
function stripped(agent: HudAgent, current: string | undefined, hostPlatform: NodeJS.Platform | null): string {
  const value = current ?? ''
  const flags = readHudLaunchFlags(agent, value, hostPlatform)
  return flags.readable && flags.ours.length > 0 ? withoutSpans(value, flags.ours) : value
}

export function withAgentHudDesktopFlag(
  agent: HudAgent,
  current: string | undefined,
  hostPlatform: NodeJS.Platform | null
): string {
  const value = current ?? ''
  const flags = readHudLaunchFlags(agent, value, hostPlatform)
  // Unsplittable, ours would land inside the user's open quote.
  if (!flags.readable) {
    return value
  }
  const base = flags.ours.length > 0 ? withoutSpans(value, flags.ours) : value.trim()
  if (flags.usersOwn !== null) {
    return base
  }
  const flag = agentHudLaunchFlag(agent, hostPlatform)
  return base ? `${base} ${flag}` : flag
}

export function withoutAgentHudDesktopFlag(
  agent: HudAgent,
  current: string | undefined,
  hostPlatform: NodeJS.Platform | null = null
): string {
  return stripped(agent, current, hostPlatform)
}

/** Why the switch cannot put the beacon flag on for this agent, or null. */
export function agentHudDesktopFlagRefusal(
  agent: HudAgent,
  current: string,
  hostPlatform: NodeJS.Platform | null
): string | null {
  const flags = readHudLaunchFlags(agent, current, hostPlatform)
  if (!flags.readable) {
    return `the saved arguments do not split the way Orca splits them (${flags.reason}), so they are left as they are`
  }
  return flags.usersOwn === null
    ? null
    : `the saved arguments carry the user's own ${flags.usersOwn}, which the beacon flag would replace, so none is added`
}

/**
 * The args a launch on a Windows host starts with: its saved ones, less any
 * beacon flag an earlier build saved there. The connect sync takes that flag
 * out, but a tab opened or a session resumed before its write lands would
 * start with it, and Claude refuses to (see `hostTakesAgentHudFlag`).
 */
export function withoutStaleWindowsHudFlag(
  agent: TuiAgent,
  args: string,
  hostPlatform: NodeJS.Platform | null
): string {
  if (hostPlatform !== 'win32' || (agent !== 'claude' && agent !== 'codex')) {
    return args
  }
  const cleaned = stripped(agent, args, hostPlatform)
  return cleaned === args.trim() ? args : cleaned
}

type HostSettingsLike = { agentDefaultArgs?: Partial<Record<TuiAgent, string>> }

function resultOf(response: unknown): Record<string, unknown> | null {
  const envelope = response as { ok?: boolean; result?: unknown } | null
  return envelope?.ok === true && envelope.result && typeof envelope.result === 'object'
    ? (envelope.result as Record<string, unknown>)
    : null
}

/**
 * Bring the host's launch profile in line with the switch. Reads the current
 * profile first and writes only when something changes, so a reconnect on an
 * already-correct host costs one `settings.get` plus one `status.get` and
 * nothing else. Returns what was written, or null.
 */
export async function syncAgentHudDesktopLaunchArgs(
  client: RpcClient,
  enabled: boolean
): Promise<Partial<Record<TuiAgent, string>> | null> {
  const [settingsResponse, statusResponse] = await Promise.all([
    client.sendRequest('settings.get').catch(() => null),
    client.sendRequest('status.get').catch(() => null)
  ])
  const settings = resultOf(settingsResponse)
  if (!settings) {
    return null
  }
  // A host that will not say what it is gets nothing written either way: a
  // failed `status.get` once read as "not Windows" and put a flag straight back
  // onto a Windows host. Orca has reported `hostPlatform` since its 2026-08-13
  // builds, so an unknown platform is a failed read, not an old host.
  const hostPlatform = readMobileRuntimeHostPlatform(resultOf(statusResponse))
  if (hostPlatform === null) {
    return null
  }
  // A Windows host takes no flag, and one this app already saved there is
  // taken back out even while the switch is on: it stops Claude from starting.
  const writeFlag = enabled && hostTakesAgentHudFlag(hostPlatform)
  const current = ((settings as HostSettingsLike).agentDefaultArgs ?? {}) as Partial<
    Record<TuiAgent, string>
  >
  const next: Partial<Record<TuiAgent, string>> = { ...current }
  let changed = false
  for (const agent of HUD_AGENTS) {
    // What Orca would launch with. A missing key means its defaults, which are
    // the skip-permissions flags; an empty one means none, which is how its
    // ask-permissions mode is saved. So a key is never deleted, and an agent
    // with no saved args keeps its defaults in front of the flag.
    const launched = resolveTuiAgentLaunchArgs(agent, current)
    const refusal = writeFlag ? agentHudDesktopFlagRefusal(agent, launched, hostPlatform) : null
    if (refusal !== null) {
      // Otherwise a desktop tab with no HUD says nothing about why.
      console.warn(`[hud-desktop-args] ${agent}: no beacon flag on the desktop: ${refusal}`)
    }
    const value = writeFlag
      ? withAgentHudDesktopFlag(agent, launched, hostPlatform)
      : withoutAgentHudDesktopFlag(agent, launched, hostPlatform)
    if (value !== launched) {
      changed = true
      next[agent] = value
    }
  }
  if (!changed) {
    return null
  }
  const response = await client
    .sendRequest('settings.update', { agentDefaultArgs: next })
    .catch(() => null)
  return resultOf(response) ? next : null
}
