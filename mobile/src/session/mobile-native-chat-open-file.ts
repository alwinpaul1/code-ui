import { splitFilePathLineSuffix } from '../components/markdown-file-path-detection'
import type { FileTapOpenFailure } from './mobile-file-tap-failure'
import { isBareFileName, lookUpFileTapName } from './mobile-file-tap-name-lookup'
import {
  openMobileFileTap,
  type FileTapSessionTab,
  type OpenMobileFileTapOptions
} from './mobile-file-tap-open'
import { shouldActivateOpenedMobileSessionTab } from './opened-mobile-session-tab'

/** The files a bare tapped name matched, for the user to choose between. */
export type FileTapMatchOffer = {
  /** The tapped base name, without any `:line:col`. */
  name: string
  /** Worktree-relative, in the host's order. Never empty. */
  paths: readonly string[]
  /** False when the desktop searched only part of the workspace, so others may exist. */
  complete: boolean
  /** Opens one of `paths` through the same flow as the tap, keeping its `:line:col`. */
  open: (relativePath: string) => void
}

export type OpenMobileNativeChatFileTapOptions<T extends FileTapSessionTab> = Omit<
  OpenMobileFileTapOptions<T>,
  'terminalHandle' | 'cwd' | 'line' | 'column'
> & {
  /** Used only for an ABSOLUTE path (a desktop image paste in the Mac temp dir):
   *  cwd cannot misplace it, and the path is echoed in this terminal's output,
   *  which is the provenance the host accepts for a user-pasted file. */
  absolutePathTerminalHandle?: string | null
  /** Asks the user which of several same-named files they meant. The tap never picks among
   *  several for them. */
  offerFileTapMatches: (offer: FileTapMatchOffer) => void
}

/**
 * Open a file reference tapped in native chat: same haptic / preview-route /
 * tab-activation flow as terminal taps, but chat paths are worktree-root
 * relative (or absolute), so resolution deliberately passes no terminal handle
 * and no cwd — a terminal's live cwd (e.g. `<worktree>/mobile`) would misplace
 * them. Agent-style `path:line(:col)` citations carry their location through.
 *
 * Agents cite bare names constantly (`index.ts`), and root-relative resolution
 * finds one only at the root. So a bare name that MISSES is looked up in the
 * workspace: one match opens, several are offered, none says so. Resolve comes
 * first, so a root file and any path with a folder behave exactly as before.
 */
export function openMobileNativeChatFileTap<T extends FileTapSessionTab>(
  options: OpenMobileNativeChatFileTapOptions<T>
): void {
  const { path, line, column } = splitFilePathLineSuffix(options.pathText)
  const { absolutePathTerminalHandle, offerFileTapMatches, onOpenFailed, ...rest } = options
  // The same gate reportOpenFailure applies: a user who moved on hears nothing, and is offered
  // nothing.
  const stillWanted = (): boolean =>
    shouldActivateOpenedMobileSessionTab(options.getActivationState(false))
  const report = (failure: FileTapOpenFailure): void => {
    if (onOpenFailed && stillWanted()) {
      onOpenFailed(failure)
    }
  }
  const open = (pathText: string, lookUpOnMiss: boolean): void => {
    openMobileFileTap<T>({
      ...rest,
      ...(absolutePathTerminalHandle && pathText.startsWith('/')
        ? { terminalHandle: absolutePathTerminalHandle }
        : {}),
      pathText,
      line,
      column,
      // Always passed, even without onOpenFailed: a miss still has to reach the lookup.
      onOpenFailed: (failure) => {
        if (lookUpOnMiss && failure.kind === 'not-found' && isBareFileName(pathText)) {
          void lookUpThenOpen(pathText)
          return
        }
        report(failure)
      }
    })
  }
  const lookUpThenOpen = async (name: string): Promise<void> => {
    const lookup = await lookUpFileTapName(options.client, options.worktreeId, name, stillWanted)
    if (lookup.kind === 'abandoned' || !stillWanted()) {
      return
    }
    if (lookup.kind === 'failed') {
      report(lookup.failure)
      return
    }
    const { paths, complete } = lookup
    if (paths.length === 0) {
      report({ kind: 'no-file-named', name, partial: !complete })
      return
    }
    // One match opens, even from a search that covered part of the workspace:
    // a sheet with one row to tap was only a step in the way (2026-09-26).
    // Several are offered.
    if (paths.length === 1) {
      open(paths[0]!, false)
      return
    }
    offerFileTapMatches({ name, paths, complete, open: (picked) => open(picked, false) })
  }
  open(path, true)
}
