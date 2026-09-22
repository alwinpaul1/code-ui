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

/** Which scanned skill roots an agent can actually invoke. An agent with none
 *  of these roots gets no scanned skills — Grok must not list Claude's. */
function skillProvidersForAgent(agent: string): readonly SkillProvider[] {
  switch (agent) {
    case 'claude':
    case 'openclaude':
      return ['claude']
    case 'codex':
      return ['codex']
    default:
      return []
  }
}

/** A skill that lives under a Grok profile (`~/.grok/skills` or a repo `.grok`). */
function isGrokOwnedSkill(skill: DiscoveredSkill): boolean {
  if (skill.sourceLabel === 'Grok skills' || skill.sourceLabel === 'Grok repo skills') {
    return true
  }
  const paths = [skill.rootPath, ...(skill.rootPaths ?? [])]
  return paths.some((path) => path.split(/[\\/]/).includes('.grok'))
}

/**
 * Drop skills the active agent cannot see.
 *
 * Why: the host scans every agent's roots at once, so without this a Grok
 * chat's `/` menu listed `~/.claude/skills`. Only the providers that agent
 * reads are kept, and only the names the scan found on disk.
 */
export function filterNativeChatSkillsForAgent(
  skills: readonly DiscoveredSkill[],
  agent: string | null
): DiscoveredSkill[] {
  if (!agent) {
    return []
  }
  if (agent === 'grok') {
    return skills.filter(isGrokOwnedSkill)
  }
  const providers = skillProvidersForAgent(agent)
  if (providers.length === 0) {
    return []
  }
  return skills.filter(
    (skill) =>
      !isGrokOwnedSkill(skill) && skill.providers.some((provider) => providers.includes(provider))
  )
}
