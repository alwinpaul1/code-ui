import type {
  RuntimeNativeChatFileContext,
  RuntimeTerminalPathResolution
} from '../../../src/shared/runtime-types'
import { filesystemPathToFileUri } from '../../../src/shared/file-uri-path'
import { createMobileFilePreviewHref } from '../files/mobile-file-preview-route'
import { classifyMobileArtifact } from './mobile-artifact-kind'
import { refusalFailure, thrownFailure, type FileTapOpenFailure } from './mobile-file-tap-failure'
import { fileTapOpenRun, fileTapPathResolve } from './mobile-session-launch-operations'
import { shouldActivateOpenedMobileSessionTab } from './opened-mobile-session-tab'
import type { RpcOperationSender } from '../transport/rpc-operation-sender'

export type FileTapSessionTab = {
  id: string
  relativePath?: string
}

export type OpenMobileFileTapOptions<T extends FileTapSessionTab> = {
  client: RpcOperationSender
  hostId: string
  worktreeId: string
  worktreeName?: string
  terminalHandle?: string | null
  pathText: string
  cwd?: string | null
  nativeChatContext?: RuntimeNativeChatFileContext | null
  line: number | null
  column: number | null
  pushPreviewRoute: (href: ReturnType<typeof createMobileFilePreviewHref>) => void
  openBrowser: (url: string) => void
  triggerOpenFeedback: () => void
  fetchSessionTabs: () => Promise<void>
  getSessionTabs: () => readonly T[]
  getActiveSessionTabId: () => string | null
  getActivationState: (activated: boolean) => {
    activated: boolean
    activationSeq: number
    latestActivationSeq: number
    sourceTerminalHandle: string | null
    activeTerminalHandle: string | null
    sourceSessionTabId?: string | null
    activeSessionTabId?: string | null
    activeTabType: string | null
  }
  switchSessionTab: (tab: T) => void
  scheduleDelayedAction: (callback: () => void, delayMs: number) => unknown
  /** Invoked, with the reason, when the tap cannot open anything — and only while the source tab
   *  is still the active one. Omitted on surfaces that keep the historical silent miss. */
  onOpenFailed?: (failure: FileTapOpenFailure) => void
}

export function openMobileFileTap<T extends FileTapSessionTab>(
  options: OpenMobileFileTapOptions<T>
): void {
  void openMobileFileTapAsync(options).catch((error: unknown) => {
    // File taps are best-effort: a failed host resolution should leave terminal
    // focus/input untouched. Surfaces that want feedback pass onOpenFailed.
    reportOpenFailure(options, thrownFailure(error))
  })
}

function reportOpenFailure<T extends FileTapSessionTab>(
  options: OpenMobileFileTapOptions<T>,
  failure: FileTapOpenFailure
): void {
  if (
    options.onOpenFailed &&
    shouldActivateOpenedMobileSessionTab(options.getActivationState(false))
  ) {
    options.onOpenFailed(failure)
  }
}

/**
 * What an unopenable resolution says about itself (Orca's resolveTerminalPath, read at
 * ac675ded6e): it names a relative path only where it looked, and the workspace it looked in.
 */
function unopenedResolutionFailure(
  resolved: RuntimeTerminalPathResolution,
  worktreeId: string
): FileTapOpenFailure {
  if (resolved.isDirectory) {
    return { kind: 'folder' }
  }
  if (resolved.relativePath == null) {
    // An absolute path with no relative one is outside every workspace the host knows, answered
    // without a look. Neither path is the host declining to place it at all (`~` on SSH).
    return resolved.absolutePath ? { kind: 'outside-workspace' } : { kind: 'unreachable' }
  }
  const owner = resolved.worktree?.trim()
  return owner && owner !== worktreeId ? { kind: 'not-found-elsewhere' } : { kind: 'not-found' }
}

async function openMobileFileTapAsync<T extends FileTapSessionTab>(
  options: OpenMobileFileTapOptions<T>
): Promise<void> {
  const worktree = `id:${options.worktreeId}`
  let response
  try {
    response = await fileTapPathResolve.request(
      options.client,
      {
        worktree,
        pathText: options.pathText,
        // Why: opts into sibling-workspace resolutions; this caller honors resolved.worktree.
        crossWorkspace: true,
        ...(options.terminalHandle && options.terminalHandle.trim().length > 0
          ? { terminal: options.terminalHandle }
          : {}),
        ...(options.cwd && options.cwd.trim().length > 0 ? { cwd: options.cwd } : {}),
        ...(options.nativeChatContext ? { nativeChatContext: options.nativeChatContext } : {})
      },
      { timeoutMs: 10_000 }
    )
  } catch {
    reportOpenFailure(options, { kind: 'no-answer' })
    return
  }
  const accepted = fileTapPathResolve.interpret(response)
  if (!accepted.accepted) {
    reportOpenFailure(options, refusalFailure(response))
    return
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Preserve the established response shape at this boundary.
  const resolved = accepted.value as RuntimeTerminalPathResolution
  if (!resolved.exists || resolved.isDirectory) {
    reportOpenFailure(options, unopenedResolutionFailure(resolved, options.worktreeId))
    return
  }
  // Not a failure: the user moved off the source tab mid-resolve.
  if (!shouldActivateOpenedMobileSessionTab(options.getActivationState(false))) {
    return
  }
  const resolvedWorktreeId = resolved.worktree?.trim() || options.worktreeId
  const resolvedWorktree = `id:${resolvedWorktreeId}`
  const resolvedWorktreeName =
    resolvedWorktreeId === options.worktreeId ? options.worktreeName : undefined

  if (resolved.openTarget?.kind === 'absolute-file') {
    options.triggerOpenFeedback()
    options.pushPreviewRoute(
      createMobileFilePreviewHref({
        hostId: options.hostId,
        worktreeId: resolvedWorktreeId,
        source: 'terminalArtifact',
        absolutePath: resolved.openTarget.absolutePath,
        grantId: resolved.openTarget.grantId,
        pathText: options.pathText,
        ...(options.cwd && options.cwd.trim().length > 0 ? { cwd: options.cwd } : {}),
        ...(options.terminalHandle && options.terminalHandle.trim().length > 0
          ? { terminal: options.terminalHandle }
          : {}),
        ...(options.nativeChatContext
          ? {
              nativeChatTab: options.nativeChatContext.tabId,
              nativeChatSession: options.nativeChatContext.sessionId
            }
          : {}),
        name: displayNameFromPath(resolved.openTarget.absolutePath),
        ...(options.line !== null ? { line: String(options.line) } : {}),
        ...(options.column !== null ? { column: String(options.column) } : {}),
        ...(resolvedWorktreeName ? { worktreeName: resolvedWorktreeName } : {})
      })
    )
    return
  }

  const openedPath =
    resolved.openTarget?.kind === 'worktree-file'
      ? resolved.openTarget.relativePath
      : resolved.relativePath
  if (!openedPath) {
    // Exists, but with neither a workspace path nor a grant to read it by.
    reportOpenFailure(options, { kind: 'outside-workspace' })
    return
  }
  options.triggerOpenFeedback()
  if (
    resolvedWorktreeId !== options.worktreeId ||
    options.line !== null ||
    options.column !== null ||
    phoneShowsItself(openedPath)
  ) {
    options.pushPreviewRoute(
      createMobileFilePreviewHref({
        hostId: options.hostId,
        worktreeId: resolvedWorktreeId,
        source: 'worktree',
        relativePath: openedPath,
        name: displayNameFromPath(openedPath),
        ...(options.line !== null ? { line: String(options.line) } : {}),
        ...(options.column !== null ? { column: String(options.column) } : {}),
        ...(resolvedWorktreeName ? { worktreeName: resolvedWorktreeName } : {})
      })
    )
    return
  }
  if (
    classifyMobileArtifact(openedPath) === 'html' &&
    resolved.openTarget?.kind === 'worktree-file' &&
    resolved.openTarget.provider === 'local'
  ) {
    options.openBrowser(filesystemPathToFileUri(resolved.openTarget.absolutePath))
    return
  }
  let openResponse
  try {
    openResponse = await fileTapOpenRun.request(
      options.client,
      { worktree: resolvedWorktree, relativePath: openedPath },
      { timeoutMs: 15_000 }
    )
  } catch {
    reportOpenFailure(options, { kind: 'no-answer' })
    return
  }
  const opened = fileTapOpenRun.interpret(openResponse)
  if (!opened.accepted) {
    reportOpenFailure(options, refusalFailure(openResponse))
    return
  }
  if (!opened.value.opened) {
    reportOpenFailure(options, { kind: 'not-openable', fileKind: opened.value.kind ?? null })
    return
  }
  scheduleOpenedWorktreeTabActivation(options, openedPath)
}

function scheduleOpenedWorktreeTabActivation<T extends FileTapSessionTab>(
  options: OpenMobileFileTapOptions<T>,
  openedPath: string
): void {
  let activated = false
  const activateOpenedTab = async (): Promise<void> => {
    if (!shouldActivateOpenedMobileSessionTab(options.getActivationState(activated))) {
      return
    }
    await options.fetchSessionTabs()
    if (!shouldActivateOpenedMobileSessionTab(options.getActivationState(activated))) {
      return
    }
    const opened = options.getSessionTabs().find((tab) => tab.relativePath === openedPath)
    if (!opened) {
      return
    }
    if (options.getActiveSessionTabId() !== opened.id) {
      options.switchSessionTab(opened)
    }
    activated = true
  }

  options.scheduleDelayedAction(() => void activateOpenedTab(), 300)
  options.scheduleDelayedAction(() => void activateOpenedTab(), 900)
  options.scheduleDelayedAction(() => void activateOpenedTab(), 1800)
}

/**
 * A PDF or a raster image is shown by the phone's own viewer (files.readPreview), so the tap never
 * asks the desktop for a tab. Orca 1.4.218 answers files.open for these with `opened: false`,
 * kind `binary`, and the tap then said "binary files don't open on the phone" about a file the
 * phone draws. Files the phone shows as text keep the desktop tab; a genuinely binary one (.psd)
 * still reaches the honest refusal.
 */
function phoneShowsItself(path: string): boolean {
  const kind = classifyMobileArtifact(path)
  return kind === 'pdf' || kind === 'image'
}

function displayNameFromPath(path: string): string | undefined {
  return path.split(/[\\/]/).findLast(Boolean)
}
