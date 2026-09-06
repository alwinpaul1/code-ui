/** Orca clipboard images can be echoed by the TUI as leading bare temp paths.
 * Recognize only Orca's generated filenames, not arbitrary paths in user prose. */
export function splitOrcaPastedImagePaths(text: string): { paths: string[]; text: string } {
  const paths: string[] = []
  let rest = text
  const path =
    /^\s*((?:\/private)?\/var\/folders\/[^\s/]+\/[^\s/]+\/T\/orca-paste-\d+-[a-f0-9-]{36}\.(?:png|jpe?g|webp))(?=\s|\/|$)/i
  let match: RegExpExecArray | null
  while ((match = path.exec(rest))) {
    paths.push(match[1]!)
    rest = rest.slice(match[0].length)
  }
  return { paths, text: paths.length ? rest.trimStart() : text }
}
