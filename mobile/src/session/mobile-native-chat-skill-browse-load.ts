import type { DiscoveredSkill } from '../../../src/shared/skills'
import { serverDirectoryBrowse } from './mobile-native-chat-skill-browse-operations'
import {
  claudePluginCachePath,
  claudeSkillRoots,
  dedupeBrowsedSkills,
  pluginSkillsRoot,
  skillsFromRootListing,
  type ServerDirEntry,
  type SkillBrowseRoot
} from './mobile-native-chat-skill-browse'

/** Listings in flight at once. The home skills root alone is 200 folders to
 *  confirm; four at a time over a 250 ms relay is under a minute, in the
 *  background, and never a burst the host notices. */
const BROWSE_CONCURRENCY = 4

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
  const roots = claudeSkillRoots(home, worktreePath)
  // The home and repo roots are four listings and hold most of the menu;
  // they are reported as soon as they are in, before the plugin cache's
  // forty-odd listings, so a `/` typed a second after the tab opened is not
  // an empty card (device, 2026-09-20, "/anim" showing nothing).
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
  // SKILL.md, is not). Confirm each home and repo skill's file and drop the
  // ones without. Plugin skills sit under a `skills` folder the plugin
  // shipped and are taken as they are.
  const toConfirm = skills.filter((skill) => skill.sourceKind !== 'plugin')
  await mapLimit(toConfirm, BROWSE_CONCURRENCY, async (skill) => {
    if (!live()) {
      return
    }
    const entries = await browse(skill.directoryPath)
    if (!live()) {
      return
    }
    if (entries !== null && !entries.some((entry) => !entry.isDirectory && entry.name === 'SKILL.md')) {
      skills = skills.filter((other) => other !== skill)
      onSkills(skills)
    }
  })
}

/** Every `<marketplace>/<plugin>/<version>/skills` under the plugin cache. */
async function pluginSkillRoots(browse: Browse, cachePath: string): Promise<SkillBrowseRoot[]> {
  const dirs = (entries: ServerDirEntry[] | null) =>
    (entries ?? []).filter((entry) => entry.isDirectory && !entry.name.startsWith('.')).map((entry) => entry.name)
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
