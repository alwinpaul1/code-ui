import type { DiscoveredSkill, SkillProvider } from '../../../src/shared/skills'

/**
 * Where Claude Code's `/` menu gets its skills, as directory names the phone
 * can list.
 *
 * Why: `skills.discover`, the host's own scan, is refused to a mobile-scope
 * token on Orca 1.4.205, so the phone's `/` menu listed the curated built-ins
 * and none of the user's 200 skills, while the Claude app lists them all
 * (device, 2026-09-20). `files.browseServerDir` IS on the mobile allowlist and
 * lists any directory by absolute path — names only, no contents. That is
 * enough: a Claude Code skill is a directory under a skills root holding a
 * `SKILL.md`, invoked by the directory's name (checked against every one of
 * this machine's 210: none carries a different frontmatter name); a command is
 * a `.md` file under a commands root; a plugin skill is
 * `plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>`, invoked as
 * `/<plugin>:<skill>` (Claude Code 2.1.278). Descriptions cannot be read and
 * are left null; enabled state of a plugin cannot be read either, so every
 * cached plugin's skills are offered.
 */
export type ServerDirEntry = { name: string; isDirectory: boolean; isSymlink?: boolean }

export type SkillBrowseRoot = {
  kind: 'skills' | 'commands'
  path: string
  sourceKind: 'home' | 'repo' | 'plugin'
  sourceLabel: string
  /** Set when the root is not Claude's. Grok's profiles pass an empty list. */
  providers?: readonly SkillProvider[]
}

/** Claude Code's home profiles and, when a worktree is open, that repo's
 *  `.claude` roots. A profile directory that is not on disk lists as nothing. */
export function claudeSkillRoots(home: string, worktreePath: string | null): SkillBrowseRoot[] {
  const roots: SkillBrowseRoot[] = [
    { kind: 'skills', path: `${home}/.claude/skills`, sourceKind: 'home', sourceLabel: 'Home skills' },
    { kind: 'commands', path: `${home}/.claude/commands`, sourceKind: 'home', sourceLabel: 'Home commands' },
    { kind: 'skills', path: `${home}/.claude-work/skills`, sourceKind: 'home', sourceLabel: 'Work skills' },
    { kind: 'commands', path: `${home}/.claude-work/commands`, sourceKind: 'home', sourceLabel: 'Work commands' }
  ]
  if (worktreePath) {
    roots.push(
      { kind: 'skills', path: `${worktreePath}/.claude/skills`, sourceKind: 'repo', sourceLabel: 'Repo skills' },
      { kind: 'commands', path: `${worktreePath}/.claude/commands`, sourceKind: 'repo', sourceLabel: 'Repo commands' }
    )
  }
  return roots
}

/** Grok Build's skill profile. A directory that is not on disk lists as nothing. */
export function grokSkillRoots(home: string, worktreePath: string | null): SkillBrowseRoot[] {
  const roots: SkillBrowseRoot[] = [
    {
      kind: 'skills',
      path: `${home}/.grok/skills`,
      sourceKind: 'home',
      sourceLabel: 'Grok skills',
      providers: []
    }
  ]
  if (worktreePath) {
    roots.push({
      kind: 'skills',
      path: `${worktreePath}/.grok/skills`,
      sourceKind: 'repo',
      sourceLabel: 'Grok repo skills',
      providers: []
    })
  }
  return roots
}

export function claudePluginCachePath(home: string): string {
  return `${home}/.claude/plugins/cache`
}

/** The skills root of one cached plugin version. The label carries the plugin
 *  name in the shape `nativeChatSkillCommandName` rebuilds the `plugin:` prefix from. */
export function pluginSkillsRoot(
  cachePath: string,
  marketplace: string,
  plugin: string,
  version: string
): SkillBrowseRoot {
  return {
    kind: 'skills',
    path: `${cachePath}/${marketplace}/${plugin}/${version}/skills`,
    sourceKind: 'plugin',
    sourceLabel: `Claude plugin ${plugin}`
  }
}

/** The worktree's path, as the phone's worktree id carries it (`<repo>::<path>`). */
export function worktreePathFromId(worktreeId: string): string | null {
  const at = worktreeId.indexOf('::')
  return at === -1 ? null : worktreeId.slice(at + 2) || null
}

/** A directory Claude Code would not load as a skill: hidden, or a private
 *  holding folder such as `_sources`. */
function isSkillDirectoryName(name: string): boolean {
  return name.length > 0 && !name.startsWith('.') && !name.startsWith('_')
}

/** The skills or commands one root's listing holds. */
export function skillsFromRootListing(
  root: SkillBrowseRoot,
  entries: readonly ServerDirEntry[]
): DiscoveredSkill[] {
  const out: DiscoveredSkill[] = []
  for (const entry of entries) {
    if (root.kind === 'skills') {
      // A symlink is listed as neither directory nor file (`isDirectory:
      // false, isSymlink: true`), and 102 of this machine's 215 skills are
      // links into ~/.claude-work (device, 2026-09-20: "/ani" listed one
      // skill where the Claude app listed five). Claude Code follows the
      // link; the phone offers it and confirms what it points at.
      const linked = entry.isSymlink === true && !entry.isDirectory
      if ((!entry.isDirectory && !linked) || !isSkillDirectoryName(entry.name)) {
        continue
      }
      const directoryPath = `${root.path}/${entry.name}`
      out.push(skill(root, entry.name, directoryPath, `${directoryPath}/SKILL.md`, linked))
    } else {
      if (entry.isDirectory || !entry.name.endsWith('.md') || entry.name.startsWith('.')) {
        continue
      }
      const name = entry.name.slice(0, -'.md'.length)
      if (!isSkillDirectoryName(name)) {
        continue
      }
      out.push(skill(root, name, root.path, `${root.path}/${entry.name}`))
    }
  }
  return out
}

function skill(
  root: SkillBrowseRoot,
  name: string,
  directoryPath: string,
  skillFilePath: string,
  linked = false
): DiscoveredSkill {
  return {
    // `browse-link:` marks a symlink: the loader must SEE its SKILL.md to keep
    // it, since a link can point at a file or at nothing.
    id: `${linked ? 'browse-link' : 'browse'}:${skillFilePath}`,
    name,
    description: null,
    providers: root.providers ? [...root.providers] : ['claude'],
    sourceKind: root.sourceKind,
    sourceLabel: root.sourceLabel,
    rootPath: root.path,
    directoryPath,
    skillFilePath,
    installed: true,
    updatedAt: null
  }
}

/** Whether a browsed skill is a symlink whose target must be seen. */
export function isLinkedBrowsedSkill(skill: DiscoveredSkill): boolean {
  return skill.id.startsWith('browse-link:')
}

/** Claude and Grok can both ship a skill with the same directory name. They
 *  are different commands. Two Claude roots that list the same name are one
 *  command, the first listing winning, as are two cached versions of a plugin. */
function browsedSkillDedupeKey(entry: DiscoveredSkill): string {
  if (entry.sourceKind === 'plugin') {
    return `${entry.sourceLabel}\0${entry.name}`
  }
  const paths = [entry.rootPath, ...(entry.rootPaths ?? [])]
  const grok =
    entry.sourceLabel === 'Grok skills' ||
    entry.sourceLabel === 'Grok repo skills' ||
    paths.some((path) => path.split(/[\\/]/).includes('.grok'))
  return `${grok ? 'grok' : ''}\0${entry.name}`
}

/** One row per dispatch token. */
export function dedupeBrowsedSkills(skills: readonly DiscoveredSkill[]): DiscoveredSkill[] {
  const seen = new Set<string>()
  const out: DiscoveredSkill[] = []
  for (const entry of skills) {
    const key = browsedSkillDedupeKey(entry)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(entry)
  }
  return out
}
