import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { resolveNativeChatTranscriptAgent } from '../../../src/shared/native-chat-agent-support'
import type { DiscoveredSkill, SkillDiscoveryResult } from '../../../src/shared/skills'
import { isMobileScopeRefusal } from '../transport/mobile-scope-refusal'
import type { RpcClient } from '../transport/rpc-client'
import { browseClaudeSkills } from './mobile-native-chat-skill-browse-load'
import { worktreePathFromId } from './mobile-native-chat-skill-browse'
import { claudeConfigDirFromTranscriptPath } from './mobile-native-chat-session-agent'

/** Re-scan when the `/` menu opens and the last scan is older than this, so a
 *  skill added or removed on the desktop shows up on the next `/` without
 *  leaving the session. Short because opening the menu is the natural refresh
 *  moment; the floor only stops a menu flicker from hammering the host. */
const SKILLS_STALE_MS = 3_000

/** The directory-listing fallback is a few hundred small requests, not one
 *  scan, so it refreshes on a longer clock: a skill installed on the desktop
 *  shows up on the phone within this, or on the next connection. */
const BROWSED_SKILLS_STALE_MS = 10 * 60_000

/** How long after the chat opens, or reconnects, the skills read starts on
 *  its own, so the first `/` of a launch finds the list already read. A menu
 *  read by directory also reads a newly named Claude config dir this long
 *  after the chat names it. Why: it used to start at that first `/`, exactly
 *  while the user was typing, and its replies shared the JS thread with the
 *  controlled input: the next keys landed two seconds late in one lump (phone
 *  recording, 2026-09-20). Two seconds lets the chat's own first reads, the
 *  session and the screen, land first. */
const PRIME_SKILLS_DELAY_MS = 2_000

/** The last browsed list per worktree and Claude config dir, kept across
 *  reconnects for this launch. */
const browsedByKey = new Map<string, DiscoveredSkill[]>()

/** The chat on the active tab, whichever view the tab shows. */
export type SkillsMenuChat = { agent: string; transcriptPath: string | null }

/**
 * The Claude config dir the `/` menu lists, or null for both of this
 * machine's profiles: a Claude chat's own dir when its transcript names one,
 * null while it has not. While the tab holds no Claude chat (a shell, or a
 * Codex or Grok chat) the last dir stands. Those menus show no Claude rows,
 * and reading another profile for them was a walk nobody saw (review,
 * 2026-09-25).
 */
function useMenuClaudeConfigDir(chat: SkillsMenuChat | null): string | null {
  const own =
    chat && resolveNativeChatTranscriptAgent(chat.agent) === 'claude'
      ? claudeConfigDirFromTranscriptPath(chat.transcriptPath)
      : undefined
  const [last, setLast] = useState<string | null>(own ?? null)
  if (own !== undefined && own !== last) {
    setLast(own)
  }
  return own === undefined ? last : own
}

/**
 * Installed skills and plugin commands for the `/` menu.
 *
 * Why: the static per-agent command catalog knows `/clear` and `/model`, but
 * not the user's own skills (`/beui`, `/frontend-ui-ux`, …) or plugin commands.
 * Desktop already scans every agent's skill roots for its picker via
 * `skills.discover`; mobile asks the same host the first time the composer
 * opens a slash menu and caches the answer per worktree. A host too old to
 * know the method simply leaves the list empty — and so does a host whose
 * mobile-scope dispatch gate refuses it (Orca 1.4.205 does; see
 * transport/mobile-scope-refusal.ts). Both refusals latch: without the
 * latch the gate's refusal was re-asked every 3 s for as long as the menu
 * kept opening, and could never answer differently on that connection. This
 * is a read that fails open to an empty list, not an affordance that fails on
 * tap, which is why it is not probe-gated (orca-mobile-rpc-allowlist.test.ts).
 *
 * A refused scan is not the end of it: `files.browseServerDir` is allowed, and
 * Claude Code's skills are directories, so the phone lists them itself — the
 * home and repo skill and command roots, and every cached plugin's skills —
 * names only, the way the Claude app's `/` menu shows them (2026-09-20; see
 * mobile-native-chat-skill-browse.ts). The home roots are the session's own
 * Claude config dir, read off its transcript path (2026-09-25: a
 * ~/.claude-work session listed ~/.claude's skills and plugins). Each dir is
 * walked on its own clock, so switching between two tabs of one worktree
 * shows each its last list instead of walking again. The scan does not depend
 * on the dir: a new dir neither re-asks it nor re-arms the chat's first read.
 */
export function useMobileNativeChatSkills(args: {
  client: Pick<RpcClient, 'sendRequest'> | null
  worktreeId: string
  chatIdentity: SkillsMenuChat | null
}): { nativeChatSkills: DiscoveredSkill[]; loadNativeChatSkills: () => void } {
  const { client, worktreeId } = args
  const claudeConfigDir = useMenuClaudeConfigDir(args.chatIdentity)
  const browseKey = `${worktreeId}\0${claudeConfigDir ?? ''}`
  const [nativeChatSkills, setNativeChatSkills] = useState<DiscoveredSkill[]>([])
  const loadedAtRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)
  const unsupportedRef = useRef(false)
  const generationRef = useRef(0)
  /** Per browse key, on this connection: when the last walk that reached the
   *  home folder started, and which walks are in flight. */
  const browsedAtRef = useRef(new Map<string, number>())
  const browsingRef = useRef(new Set<string>())
  /** What the menu is for now. Read when a walk starts and when it reports, so
   *  a scan refusal or a timer that lands after a switch walks the dir on
   *  screen, and a walk for a tab the user has left fills only its own cache. */
  const shownRef = useRef({ key: browseKey, configDir: claudeConfigDir })

  useEffect(() => {
    generationRef.current++
    loadedAtRef.current = null
    inFlightRef.current = false
    unsupportedRef.current = false
    browsedAtRef.current = new Map()
    browsingRef.current = new Set()
    // A reconnect is a new client. The skills it listed last time are still
    // on the desktop's disk; showing them until the fresh listing lands beats
    // an empty `/` menu for the seconds the listing takes (2026-09-20).
    setNativeChatSkills(browsedByKey.get(browseKey) ?? [])
  }, [client, worktreeId])

  const browseSkills = useCallback(() => {
    const { key, configDir } = shownRef.current
    if (!client || browsingRef.current.has(key)) {
      return
    }
    const browsedAt = browsedAtRef.current.get(key)
    if (browsedAt !== undefined && Date.now() - browsedAt < BROWSED_SKILLS_STALE_MS) {
      return
    }
    const generation = generationRef.current
    browsingRef.current.add(key)
    const startedAt = Date.now()
    void browseClaudeSkills({
      client,
      worktreePath: worktreePathFromId(worktreeId),
      claudeConfigDir: configDir,
      live: () => generationRef.current === generation,
      onSkills: (skills) => {
        browsedByKey.set(key, skills)
        if (shownRef.current.key === key) {
          setNativeChatSkills(skills)
        }
      }
    })
      .then((reachedHome) => {
        // Only a walk that reached the home folder is a list: one that could not list even
        // that (a drop) left the menu built-ins only, and stamping it skipped every `/` for
        // BROWSED_SKILLS_STALE_MS over a link that had come back (review, 2026-09-30).
        if (reachedHome && generationRef.current === generation) {
          browsedAtRef.current.set(key, startedAt)
        }
      })
      .finally(() => {
        if (generationRef.current === generation) {
          browsingRef.current.delete(key)
        }
      })
  }, [client, worktreeId])

  // A layout effect, so it lands before any passive one: the composer asks for
  // the skills from its own effect, and a child's passive effects run before
  // this hook's. Written there, the ask in a switching commit read the tab the
  // user had left (re-review, 2026-09-25).
  useLayoutEffect(() => {
    shownRef.current = { key: browseKey, configDir: claudeConfigDir }
  }, [browseKey, claudeConfigDir])

  useEffect(() => {
    // Until a scan has answered, the list on screen is a listing, and a
    // listing belongs to one config dir: show this dir's, not the last one's.
    if (loadedAtRef.current === null) {
      setNativeChatSkills(browsedByKey.get(browseKey) ?? [])
    }
    if (!unsupportedRef.current) {
      return
    }
    // Only on this connection: a reconnect first has its own read, and this
    // one would walk the dead client and mark the dir as freshly walked.
    const generation = generationRef.current
    const timer = setTimeout(() => {
      if (generationRef.current === generation) {
        browseSkills()
      }
    }, PRIME_SKILLS_DELAY_MS)
    return () => clearTimeout(timer)
  }, [browseKey])

  const loadNativeChatSkills = useCallback(() => {
    if (unsupportedRef.current) {
      browseSkills()
      return
    }
    if (!client || inFlightRef.current) {
      return
    }
    const loadedAt = loadedAtRef.current
    if (loadedAt !== null && Date.now() - loadedAt < SKILLS_STALE_MS) {
      return
    }
    const generation = generationRef.current
    inFlightRef.current = true
    // Why: a repeat scan passes `refresh` so the host bypasses its own cache; an
    // older host ignores the flag and scans as it always did.
    const refresh = loadedAt !== null
    client
      .sendRequest('skills.discover', refresh ? { worktreeId, refresh } : { worktreeId })
      .then((response) => {
        if (generationRef.current !== generation) {
          return
        }
        if (!response.ok) {
          if (response.error.code === 'method_not_found' || isMobileScopeRefusal(response)) {
            unsupportedRef.current = true
            browseSkills()
          }
          return
        }
        loadedAtRef.current = Date.now()
        const result = response.result as Partial<SkillDiscoveryResult> | undefined
        setNativeChatSkills(Array.isArray(result?.skills) ? result.skills : [])
      })
      .catch(() => undefined)
      .finally(() => {
        if (generationRef.current === generation) {
          inFlightRef.current = false
        }
      })
  }, [browseSkills, client, worktreeId])

  useEffect(() => {
    if (!client) {
      return
    }
    const timer = setTimeout(loadNativeChatSkills, PRIME_SKILLS_DELAY_MS)
    return () => clearTimeout(timer)
  }, [client, loadNativeChatSkills])

  return { nativeChatSkills, loadNativeChatSkills }
}
