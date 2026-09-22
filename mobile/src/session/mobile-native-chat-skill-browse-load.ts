import type { DiscoveredSkill } from '../../../src/shared/skills'
import { serverDirectoryBrowse } from './mobile-native-chat-skill-browse-operations'
import {
  claudePluginCachePath,
  claudeSkillRoots,
  dedupeBrowsedSkills,
  grokSkillRoots,
  isLinkedBrowsedSkill,
  pluginSkillsRoot,
  skillsFromRootListing,
  type ServerDirEntry,
  type SkillBrowseRoot
} from './mobile-native-chat-skill-browse'

/** Root and plugin listings in flight at once: a dozen or so folders, four
 *  at a time over a 250 ms relay, never a burst the host notices. */
const BROWSE_CONCURRENCY = 4
/** The SKILL.md confirmations, which run while the menu is already usable.
 *  The home skills root alone is 200 folders; one at a time is one small
 *  reply per relay round trip, under a minute in the background on the first
 *  walk of a launch, and never enough to crowd the JS thread while the user
 *  types. */
const CONFIRM_CONCURRENCY = 1
/** Per launch: which skill files have been seen (true) or found missing (false). */
const confirmedSkillFiles = new Map<string, boolean>()

/** Test seam. */
export function resetConfirmedSkillFilesForTest(): void {
  confirmedSkillFiles.clear()
}

type Browse = (path: string) => Promise<ServerDirEntry[] | null>

/**
 * The skills Claude Code would load, listed by directory through
 * `files.browseServerDir` — the fallback for a host that refuses the scan
 * (see mobile-native-chat-skill-browse.ts). `onSkills` is called once with
 * the full unverified list, then again each time a folder without `SKILL.md`
 * is dropped, so the menu fills at once and only ever shrinks. Resolves when
 * every listing is done; a listing that fails is an empty root.
 */
export async function browseClaudeSkills(args: {
  /** Whatever the browse operation sends through; the hook's client qualifies. */
  client: Parameters<typeof serverDirectoryBrowse.request>[0]
  worktreePath: string | null
  onSkills: (skills: DiscoveredSkill[]) => void
  /** False once the caller has moved on; nothing is reported after that. */
  live: () => boolean
}): Promise<void> {
  const { client, worktreePath, onSkills, live } = args
  const list = async (path: string) => {
    const reply = await serverDirectoryBrowse.request(client, { path }).catch(() => null)
    return reply ? serverDirectoryBrowse.interpret(reply) : null
  }
  const browse: Browse = async (path) => (await list(path))?.entries ?? null
  const home = (await list(''))?.resolvedPath
  if (!home || !live()) {
    return
  }
  const roots = [...claudeSkillRoots(home, worktreePath), ...grokSkillRoots(home, worktreePath)]
  // Home and repo roots (each profile that is actually on disk) hold most of
  // the menu. They are reported as soon as they are in, before the plugin
  // cache's forty-odd listings, so a `/` typed a second after the tab opened
  // is not an empty card (device, 2026-09-20, "/anim" showing nothing).
  const rootListings = await mapLimit(roots, BROWSE_CONCURRENCY, async (root) => ({
    root,
    entries: await browse(root.path)
  }))
  if (!live()) {
    return
  }
  const fromRoots = dedupeBrowsedSkills(
    rootListings.flatMap(({ root, entries }) => (entries ? skillsFromRootListing(root, entries) : []))
  )
  let skills = fromRoots
  onSkills(skills)
  const pluginRoots = await pluginSkillRoots(browse, claudePluginCachePath(home))
  const pluginListings = await mapLimit(pluginRoots, BROWSE_CONCURRENCY, async (root) => ({
    root,
    entries: await browse(root.path)
  }))
  if (!live()) {
    return
  }
  skills = dedupeBrowsedSkills([
    ...skills,
    ...pluginListings.flatMap(({ root, entries }) => (entries ? skillsFromRootListing(root, entries) : []))
  ])
  onSkills(skills)
  // A skills root can hold folders that are not skills (`_sources` is
  // filtered by name; `android-reverse-engineering-skill`, a folder with no
  // SKILL.md, is not). Confirm each home and repo row's own file and drop the
  // ones without it. Plugin skills sit under a `skills` folder the plugin
  // shipped and are taken as they are.
  // Confirmed once per launch and remembered by file path: a re-walk ten
  // minutes later asks only about names it has not seen. The first cut
  // asked about all 215 every walk, at four in flight over the relay — some
  // fifteen seconds of replies decoded on the JS thread — and typing right
  // after the `/` that started a walk lagged by seconds, with the controlled
  // input then dropping characters (device recording, 2026-09-20).
  const toConfirm = skills.filter(
    (skill) => skill.sourceKind !== 'plugin' && !confirmedSkillFiles.has(skill.skillFilePath)
  )
  let dropped = false
  await mapLimit(toConfirm, CONFIRM_CONCURRENCY, async (skill) => {
    if (!live()) {
      return
    }
    const entries = await browse(skill.directoryPath)
    if (!live()) {
      return
    }
    // A skill's file is `SKILL.md` inside its folder. A command's file is the
    // `.md` itself, and the directory listing is the commands root, which has
    // no `SKILL.md`. The path's last segment is the file either way.
    const slash = Math.max(skill.skillFilePath.lastIndexOf('/'), skill.skillFilePath.lastIndexOf('\\'))
    const fileName = skill.skillFilePath.slice(slash + 1)
    const hasSkillFile = entries !== null && entries.some((entry) => !entry.isDirectory && entry.name === fileName)
    // A folder that would not list is kept (a transient refusal is not a
    // missing skill); a LINK that would not list is dropped — it points at a
    // file, or at nothing.
    const drop = entries === null ? isLinkedBrowsedSkill(skill) : !hasSkillFile
    if (drop) {
      confirmedSkillFiles.set(skill.skillFilePath, false)
      skills = skills.filter((other) => other !== skill)
      dropped = true
    } else if (entries !== null) {
      confirmedSkillFiles.set(skill.skillFilePath, true)
    }
  })
  // Names already known to be missing their file, from an earlier walk.
  const before = skills.length
  skills = skills.filter((skill) => confirmedSkillFiles.get(skill.skillFilePath) !== false)
  if (dropped || skills.length !== before) {
    onSkills(skills)
  }
}

/** Every `<marketplace>/<plugin>/<version>/skills` under the plugin cache. */
async function pluginSkillRoots(browse: Browse, cachePath: string): Promise<SkillBrowseRoot[]> {
  // A marketplace, plugin or version folder may itself be a symlink.
  const dirs = (entries: ServerDirEntry[] | null) =>
    (entries ?? [])
      .filter((entry) => (entry.isDirectory || entry.isSymlink === true) && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  const marketplaces = dirs(await browse(cachePath))
  const plugins = (
    await mapLimit(marketplaces, BROWSE_CONCURRENCY, async (marketplace) =>
      dirs(await browse(`${cachePath}/${marketplace}`)).map((plugin) => ({ marketplace, plugin }))
    )
  ).flat()
  const versions = (
    await mapLimit(plugins, BROWSE_CONCURRENCY, async ({ marketplace, plugin }) =>
      dirs(await browse(`${cachePath}/${marketplace}/${plugin}`)).map((version) => ({
        marketplace,
        plugin,
        version
      }))
    )
  ).flat()
  return versions.map(({ marketplace, plugin, version }) =>
    pluginSkillsRoot(cachePath, marketplace, plugin, version)
  )
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length })
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      out[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return out
}
