import type { TuiAgent } from '../../../src/shared/tui-agent'
import { readMobileRuntimeHostPlatform } from '../transport/mobile-runtime-host-platform'
import type { RpcClient } from '../transport/rpc-client'
import { agentHudLaunchFlag } from './agent-hud-launch-args'

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
 * shape, so the write is idempotent, an upgrade replaces rather than stacks,
 * and 0.2.77's flags are removed wherever they are still found.
 */
const HUD_AGENTS = ['claude', 'codex'] as const
type HudAgent = (typeof HUD_AGENTS)[number]

/**
 * Every flag this app has ever written, so one pass cleans up after all of
 * them. Claude's `--settings` marker also matches 0.2.77's, which carried a
 * different script inside the same JSON envelope; `tui.status_line` is 0.2.77
 * only and is now removed, never written.
 */
const MARKERS: Record<HudAgent, RegExp[]> = {
  claude: [/\s*--settings '\{"statusLine":\{"type":"command","command":"[^']*'/g],
  codex: [
    /\s*-c 'notify=\[[^']*\]'/g,
    // 0.2.77's visible Codex footer. Removed on sight, never written again.
    /\s*-c 'tui\.status_line=\[[^']*\]'/g
  ]
}

function stripped(agent: HudAgent, current: string | undefined): string {
  return MARKERS[agent]
    .reduce((value, marker) => value.replace(marker, ''), current ?? '')
    .trim()
}

export function withAgentHudDesktopFlag(
  agent: HudAgent,
  current: string | undefined,
  hostPlatform: NodeJS.Platform | null
): string {
  const base = stripped(agent, current)
  const flag = agentHudLaunchFlag(agent, hostPlatform)
  return base ? `${base} ${flag}` : flag
}

export function withoutAgentHudDesktopFlag(agent: HudAgent, current: string | undefined): string {
  return stripped(agent, current)
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
  // Codex's notify command differs on Windows; Claude's flag does not.
  const hostPlatform = readMobileRuntimeHostPlatform(resultOf(statusResponse))
  const current = ((settings as HostSettingsLike).agentDefaultArgs ?? {}) as Partial<
    Record<TuiAgent, string>
  >
  const next: Partial<Record<TuiAgent, string>> = { ...current }
  let changed = false
  for (const agent of HUD_AGENTS) {
    const value = enabled
      ? withAgentHudDesktopFlag(agent, current[agent], hostPlatform)
      : withoutAgentHudDesktopFlag(agent, current[agent])
    if (value !== (current[agent] ?? '')) {
      changed = true
      if (value) {
        next[agent] = value
      } else {
        delete next[agent]
      }
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
