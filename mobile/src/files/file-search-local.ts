import type { DirectoryCache } from './file-tree'

/** Every file path the explorer has already listed, across all loaded folders. */
export function collectCachedFilePaths(cache: DirectoryCache): string[] {
  const paths: string[] = []
  for (const [dir, state] of Object.entries(cache)) {
    if (!state) {
      continue
    }
    for (const entry of state.entries) {
      if (!entry.isDirectory) {
        paths.push(dir ? `${dir}/${entry.name}` : entry.name)
      }
    }
  }
  return paths
}

/**
 * Instant, on-device match over listed paths. Name hits (prefix, then
 * substring) rank above matches elsewhere in the path so what the user sees in
 * the tree is what they find. Case-insensitive; every whitespace-separated
 * term must match.
 */
export function filterFilePathsLocally(
  paths: readonly string[],
  query: string,
  limit = 200
): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    return []
  }
  const namePrefix: string[] = []
  const nameSubstring: string[] = []
  const pathSubstring: string[] = []
  for (const path of paths) {
    const lower = path.toLowerCase()
    const name = lower.slice(lower.lastIndexOf('/') + 1)
    if (!terms.every((term) => lower.includes(term))) {
      continue
    }
    if (name.startsWith(terms[0]!)) {
      namePrefix.push(path)
    } else if (terms.every((term) => name.includes(term))) {
      nameSubstring.push(path)
    } else {
      pathSubstring.push(path)
    }
  }
  return [...namePrefix, ...nameSubstring, ...pathSubstring].slice(0, limit)
}

/** Local hits first, host hits appended without duplicates. */
export function mergeFileSearchResults(local: readonly string[], remote: readonly string[]): string[] {
  const seen = new Set(local)
  const merged = [...local]
  for (const path of remote) {
    if (!seen.has(path)) {
      seen.add(path)
      merged.push(path)
    }
  }
  return merged
}
