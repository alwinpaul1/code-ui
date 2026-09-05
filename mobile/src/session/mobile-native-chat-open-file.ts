import { splitFilePathLineSuffix } from '../components/markdown-file-path-detection'
import {
  openMobileFileTap,
  type FileTapSessionTab,
  type OpenMobileFileTapOptions
} from './mobile-file-tap-open'

export type OpenMobileNativeChatFileTapOptions<T extends FileTapSessionTab> = Omit<
  OpenMobileFileTapOptions<T>,
  'terminalHandle' | 'cwd' | 'line' | 'column'
> & {
  /** Used only for an ABSOLUTE path (a desktop image paste in the Mac temp dir):
   *  cwd cannot misplace it, and the path is echoed in this terminal's output,
   *  which is the provenance the host accepts for a user-pasted file. */
  absolutePathTerminalHandle?: string | null
}

/**
 * Open a file reference tapped in native chat: same haptic / preview-route /
 * tab-activation flow as terminal taps, but chat paths are worktree-root
 * relative (or absolute), so resolution deliberately passes no terminal handle
 * and no cwd — a terminal's live cwd (e.g. `<worktree>/mobile`) would misplace
 * them. Agent-style `path:line(:col)` citations carry their location through.
 */
export function openMobileNativeChatFileTap<T extends FileTapSessionTab>(
  options: OpenMobileNativeChatFileTapOptions<T>
): void {
  const { path, line, column } = splitFilePathLineSuffix(options.pathText)
  const { absolutePathTerminalHandle, ...rest } = options
  openMobileFileTap<T>({
    ...rest,
    ...(absolutePathTerminalHandle && path.startsWith('/')
      ? { terminalHandle: absolutePathTerminalHandle }
      : {}),
    pathText: path,
    line,
    column
  })
}
