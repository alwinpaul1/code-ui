import type { DiscoveredSkill, SkillProvider } from '../../../src/shared/skills'

const PLUGIN_SOURCE_LABEL = /^(?:Claude|Codex|Cursor) plugin (.+)$/i

/**
 * The token the agent's TUI accepts for a discovered skill, without its prefix.
 *
 * Why: Claude Code namespaces plugin skills as `plugin:skill` (`claude-mem:mem-search`),
 * and that is the name its own `/` menu shows. The host scan reports the bare
 * skill name plus a "Claude plugin <name>" source label, so the prefix is rebuilt
 * here rather than sending a bare `/mem-search` the TUI may not resolve.
 */
export function nativeChatSkillCommandName(skill: DiscoveredSkill): string {
  const name = skill.name.trim()
  if (skill.sourceKind !== 'plugin' || name.includes(':')) {
    return name
  }
  const plugin = PLUGIN_SOURCE_LABEL.exec(skill.sourceLabel)?.[1]?.trim()
  return plugin ? `${plugin}:${name}` : name
}

/** Which scanned skill roots an agent can actually invoke. */
function skillProvidersForAgent(agent: string): readonly SkillProvider[] | null {
  switch (agent) {
    case 'claude':
    case 'openclaude':
      return ['claude']
    case 'codex':
      return ['codex']
    default:
      return null
  }
}

/**
 * Drop skills the active agent cannot see.
 *
 * Why: the host scans every agent's roots at once (Codex home, Cursor home, …),
 * so without this a Claude session's `/` menu lists Codex-only skills that
 * Claude Code would reject. Agents with no known root keep the full list.
 */
export function filterNativeChatSkillsForAgent(
  skills: readonly DiscoveredSkill[],
  agent: string | null
): DiscoveredSkill[] {
  const providers = agent ? skillProvidersForAgent(agent) : null
  if (!providers) {
    return [...skills]
  }
  return skills.filter((skill) => skill.providers.some((provider) => providers.includes(provider)))
}
