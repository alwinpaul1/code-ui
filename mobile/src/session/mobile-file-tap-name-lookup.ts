import type { RpcAcceptedResult } from '../transport/rpc-accepted-result'
import type { RpcOperationSender } from '../transport/rpc-operation-sender'
import type { RpcResponse } from '../transport/types'
import { refusalFailure, thrownFailure, type FileTapOpenFailure } from './mobile-file-tap-failure'
import { fileTapNameInventoryRead, fileTapNameSearchRead } from './mobile-session-launch-operations'

/** The host's `files.searchPaths` schema refuses a limit above 32 (Orca rpc/methods/files.ts). */
export const FILE_TAP_NAME_SEARCH_LIMIT = 32
/** A first search on a large SSH workspace builds the host's inventory; match `files.open`'s wait. */
const FILE_TAP_NAME_LOOKUP_TIMEOUT_MS = 15_000

export type FileTapNameLookup =
  /** `complete`: the answer covered the whole workspace, so one match is the only one. */
  | { kind: 'found'; paths: string[]; complete: boolean }
  | { kind: 'failed'; failure: FileTapOpenFailure }
  /** The tap stopped mattering before the lookup finished, so it asked no more. */
  | { kind: 'abandoned' }

type NameListing = { paths: string[]; truncated: boolean }

type ListingRead =
  | { kind: 'listed'; listing: NameListing }
  /** The host answered no: the other source may still know. */
  | { kind: 'refused'; failure: FileTapOpenFailure }
  /** No usable answer at all: nothing to ask the other source about. */
  | { kind: 'failed'; failure: FileTapOpenFailure }

/**
 * A tapped path with no folder in it. Chat resolves against the worktree root, so this is the one
 * shape that can miss purely because the agent left the folder out.
 */
export function isBareFileName(path: string): boolean {
  return path.length > 0 && !/[\\/]/.test(path)
}

/** The folder a match sits in, relative to the worktree root; '' at the root itself. */
export function fileTapMatchFolder(relativePath: string): string {
  const cut = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'))
  return cut <= 0 ? '' : relativePath.slice(0, cut)
}

function exactMatches(paths: readonly string[], name: string): string[] {
  return paths.filter((path) => path.slice(path.search(/[^\\/]*$/)) === name)
}

/** Both listings' matches, once each, in the host's own sorted order. */
function mergedMatches(first: readonly string[], second: readonly string[]): string[] {
  return [...new Set([...first, ...second])].sort((a, b) => a.localeCompare(b))
}

/**
 * Every file in the workspace whose base name is exactly `name`.
 *
 * "The workspace" is what the desktop's Quick Open lists: it leaves out node_modules, .git and the
 * other directories its blocklist names, so a name found only there is out of reach, here as on
 * the desktop.
 *
 * The host search first, the composer's own. A search that found the name and covered everything
 * is the answer. Anything short of that is checked against `files.list`:
 * - The search ranks prefix and substring matches together and stops at 32, so a search that says
 *   it was cut, or fills the whole page, cannot prove a single match is the only one.
 * - It ranks over a copy of the inventory the host keeps for 30 s, older than a file an agent has
 *   just written and cited, so "no such name" is confirmed against the list, which is read fresh.
 * - A refused search goes to the list too, as the composer does on a desktop that predates the
 *   search (`method_not_found`).
 * A rejected search does not: a second request down the same dead link says nothing new. The list
 * stops at 5,000 files where the search's copy stops at 20,000, so neither covers the other and
 * the matches of both are kept.
 *
 * The price: a name found nowhere waits on the list before its line shows, which on the desktop is
 * a whole-workspace scan (over SSH, a remote listing) and up to 5,000 rows over the relay. One gap
 * is left open on purpose: a complete search that finds the name is trusted without the list, which
 * would put that scan on every tap. A same-named file written in the 30 s before the tap can be
 * missed then. Never throws.
 */
export async function lookUpFileTapName(
  client: RpcOperationSender,
  worktreeId: string,
  name: string,
  /** Checked before the list is read: on the desktop that is a whole-workspace scan. */
  stillWanted: () => boolean
): Promise<FileTapNameLookup> {
  const worktree = `id:${worktreeId}`
  const options = { timeoutMs: FILE_TAP_NAME_LOOKUP_TIMEOUT_MS }
  const search = await readListing(
    () =>
      fileTapNameSearchRead.request(
        client,
        { worktree, query: name, limit: FILE_TAP_NAME_SEARCH_LIMIT },
        options
      ),
    fileTapNameSearchRead.interpret
  )
  if (search.kind === 'failed') {
    return search
  }
  const searched = search.kind === 'listed' ? search.listing : null
  const searchMatches = searched ? exactMatches(searched.paths, name) : []
  const searchComplete =
    searched !== null && !searched.truncated && searched.paths.length < FILE_TAP_NAME_SEARCH_LIMIT
  if (searchComplete && searchMatches.length > 0) {
    return { kind: 'found', paths: searchMatches, complete: true }
  }
  if (!stillWanted()) {
    return { kind: 'abandoned' }
  }
  const inventory = await readListing(
    () => fileTapNameInventoryRead.request(client, { worktree }, options),
    fileTapNameInventoryRead.interpret
  )
  if (inventory.kind === 'listed') {
    // Completeness is the list's alone. A search that got here was cut, refused, or is the stale
    // "no such name" the list is checking, and none of those vouches for what the list skipped.
    return {
      kind: 'found',
      paths: mergedMatches(searchMatches, exactMatches(inventory.listing.paths, name)),
      complete: !inventory.listing.truncated
    }
  }
  // A search the list could not check is still an answer, as complete as it was.
  if (searched) {
    return { kind: 'found', paths: searchMatches, complete: searchComplete }
  }
  return { kind: 'failed', failure: inventory.failure }
}

async function readListing(
  send: () => Promise<RpcResponse>,
  interpret: (response: RpcResponse) => RpcAcceptedResult<NameListing>
): Promise<ListingRead> {
  let response: RpcResponse
  try {
    response = await send()
  } catch {
    return { kind: 'failed', failure: { kind: 'no-answer' } }
  }
  let verdict: RpcAcceptedResult<NameListing>
  try {
    verdict = interpret(response)
  } catch (error) {
    return { kind: 'failed', failure: thrownFailure(error) }
  }
  return verdict.accepted
    ? { kind: 'listed', listing: verdict.value }
    : { kind: 'refused', failure: refusalFailure(response) }
}
