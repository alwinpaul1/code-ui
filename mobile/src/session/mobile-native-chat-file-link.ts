import {
  normalizeFilePath,
  splitFilePathLineSuffix
} from '../components/markdown-file-path-detection'

// What a hold on an inline file link offers, after the Claude app's menu
// (com.anthropic.claude 1.261009.20, xt20.java:87-91 for the rows, dqh.java:25-50
// for what they copy): the path as written, then
//
//   Open                  the tap's own action
//   Copy file name        the path's last segment (`cwy.f`)
//   Copy relative path    the path relative to the project (`crh.c.b`), and the
//                         row is left out when the file has none
//
// Strings (res/values/strings.xml): open "Open", ccr_inline_link_menu_copy_file_name
// "Copy file name", ccr_inline_link_menu_copy_relative_path "Copy relative path".
//
// NOT adopted from the app's tap flow (g94.java:1240, yv8.java:3645): "Open %1$s?"
// with "This link opens a file Claude sent in this session", and the snackbar
// "%1$s isn't on this device. Ask Claude to send the file to open it here." Those
// are for a cloud session's files, which live in a container the phone has to be
// sent from. Here the project is on the desktop, a tap opens it from there, and a
// path that will not open already says why (mobile-file-tap-failure.ts: "no such
// file in <workspace>", "it is outside <workspace>", and the rest), which the app's
// one sentence would replace with less.

export type FileLinkMenuEntry = 'open' | 'copy-file-name' | 'copy-relative-path'

export const FILE_LINK_MENU_LABELS: Record<FileLinkMenuEntry, string> = {
  open: 'Open',
  'copy-file-name': 'Copy file name',
  'copy-relative-path': 'Copy relative path'
}

export type FileLinkNames = {
  /** The last segment; null where there is none to copy. */
  fileName: string | null
  /** The path from the project root, null for an absolute path: the phone is not told where
   *  the project root is, and a guess would copy a wrong path. */
  relativePath: string | null
}

/** `/x`, `~/x`, `C:\x` and `C:/x`: a path that does not start at the project. */
function isAbsolutePath(path: string): boolean {
  return /^([\\/]|~[\\/]|[A-Za-z]:[\\/])/.test(path)
}

/**
 * What a link's two copy rows would put on the clipboard. The `:line:column`
 * tail and a leading `./` are not part of the file; a `../` is.
 */
export function fileLinkNames(pathText: string): FileLinkNames {
  const written = pathText.trim()
  if (!written) {
    return { fileName: null, relativePath: null }
  }
  const path = normalizeFilePath(splitFilePathLineSuffix(written).path)
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0)
  const fileName = segments.at(-1) ?? null
  return { fileName, relativePath: fileName === null || isAbsolutePath(path) ? null : path }
}

/** The rows a link's menu draws, in the app's order. */
export function fileLinkMenuEntries(names: FileLinkNames): FileLinkMenuEntry[] {
  const entries: FileLinkMenuEntry[] = ['open']
  if (names.fileName !== null) {
    entries.push('copy-file-name')
  }
  if (names.relativePath !== null) {
    entries.push('copy-relative-path')
  }
  return entries
}
