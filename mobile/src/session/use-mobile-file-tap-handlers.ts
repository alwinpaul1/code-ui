import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from 'react'
import { useRouteHandoff } from '../navigation/route-handoff'
import { triggerSelection } from '../platform/haptics'
import { describeFileTapOpenFailure } from './mobile-file-tap-failure'
import { openMobileFileTap, type FileTapSessionTab } from './mobile-file-tap-open'
import { openMobileNativeChatFileTap, type FileTapMatchOffer } from './mobile-native-chat-open-file'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcOperationSender } from '../transport/rpc-operation-sender'

/** The drawer that asks which of several same-named files a chat tap meant. */
export type FileTapMatchPickerModel = {
  /** What the drawer lists. Kept while it animates closed, so the rows do not blank out. */
  offer: FileTapMatchOffer | null
  visible: boolean
  /** A row was pressed. The file opens once the drawer has finished closing. */
  pick: (relativePath: string) => void
  close: () => void
  /** The drawer finished hiding: open what was picked, if anything, and forget the offer. */
  afterClose: () => void
}

type MobileFileTapHandlerOptions<T extends FileTapSessionTab> = {
  /** `getState` says whether a failed request met a dead link or a silent desktop. */
  client: (RpcOperationSender & Partial<Pick<RpcClient, 'getState'>>) | null
  hostId: string
  worktreeId: string
  worktreeName?: string
  nativeChatSessionId: string | null
  activeHandleRef: MutableRefObject<string | null>
  terminalCwdRef: MutableRefObject<Map<string, string>>
  openBrowser: (url: string) => void
  fetchSessionTabs: () => Promise<void>
  getSessionTabs: () => readonly T[]
  getActiveSessionTabId: () => string | null
  getActiveSessionTabType: () => string | null
  switchSessionTab: (tab: T) => void
  scheduleDelayedAction: (callback: () => void, delayMs: number) => unknown
  reportChatTapFailure: (message: string) => void
}

/**
 * Tap-to-open handlers for file references, shared by the terminal (link taps
 * with the terminal's cwd) and native chat (worktree-root-relative paths, with
 * failure feedback). Handlers are identity-stable and read the latest options at
 * dispatch time; the shared activation seq lets a newer tap on either surface
 * supersede an in-flight one.
 */
export function useMobileFileTapHandlers<T extends FileTapSessionTab>(
  options: MobileFileTapHandlerOptions<T>
): {
  handleFileTap: (
    handle: string,
    pathText: string,
    line: number | null,
    column: number | null
  ) => void
  handleNativeChatFileTap: (pathText: string) => void
  fileTapMatchPicker: FileTapMatchPickerModel
} {
  const {
    activeHandleRef,
    client,
    fetchSessionTabs,
    getActiveSessionTabId,
    getActiveSessionTabType,
    getSessionTabs,
    hostId,
    nativeChatSessionId,
    openBrowser,
    scheduleDelayedAction,
    reportChatTapFailure,
    switchSessionTab,
    terminalCwdRef,
    worktreeId,
    worktreeName
  } = options
  const router = useRouteHandoff()
  const routerRef = useRef(router)
  const optionsRef = useRef(options)
  const activationSeqRef = useRef(0)
  const [matchOffer, setMatchOffer] = useState<FileTapMatchOffer | null>(null)
  const [matchPickerVisible, setMatchPickerVisible] = useState(false)
  const matchOfferRef = useRef<FileTapMatchOffer | null>(null)
  const pickedMatchRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    routerRef.current = router
    optionsRef.current = {
      activeHandleRef,
      client,
      fetchSessionTabs,
      getActiveSessionTabId,
      getActiveSessionTabType,
      getSessionTabs,
      hostId,
      nativeChatSessionId,
      openBrowser,
      scheduleDelayedAction,
      reportChatTapFailure,
      switchSessionTab,
      terminalCwdRef,
      worktreeId,
      worktreeName
    }
  }, [
    activeHandleRef,
    client,
    fetchSessionTabs,
    getActiveSessionTabId,
    getActiveSessionTabType,
    getSessionTabs,
    hostId,
    nativeChatSessionId,
    openBrowser,
    router,
    scheduleDelayedAction,
    reportChatTapFailure,
    switchSessionTab,
    terminalCwdRef,
    worktreeId,
    worktreeName
  ])

  const handleFileTap = useCallback(
    (handle: string, pathText: string, line: number | null, column: number | null) => {
      const current = optionsRef.current
      if (handle !== current.activeHandleRef.current || !current.client) {
        return
      }
      const activationSeq = ++activationSeqRef.current
      openMobileFileTap<T>({
        client: current.client,
        hostId: current.hostId,
        worktreeId: current.worktreeId,
        worktreeName: current.worktreeName,
        terminalHandle: handle,
        pathText,
        cwd: current.terminalCwdRef.current.get(handle) ?? null,
        line,
        column,
        pushPreviewRoute: (href) => routerRef.current.push(href),
        openBrowser: current.openBrowser,
        triggerOpenFeedback: triggerSelection,
        fetchSessionTabs: current.fetchSessionTabs,
        getSessionTabs: current.getSessionTabs,
        getActiveSessionTabId: current.getActiveSessionTabId,
        getActivationState: (activated) => ({
          activated,
          activationSeq,
          latestActivationSeq: activationSeqRef.current,
          sourceTerminalHandle: handle,
          activeTerminalHandle: current.activeHandleRef.current,
          activeTabType: current.getActiveSessionTabType()
        }),
        switchSessionTab: current.switchSessionTab,
        scheduleDelayedAction: current.scheduleDelayedAction
      })
    },
    []
  )

  const handleNativeChatFileTap = useCallback((pathText: string) => {
    const current = optionsRef.current
    const sourceTerminalHandle = current.activeHandleRef.current
    const nativeChatSessionId = current.nativeChatSessionId
    const nativeChatTabId = current.getActiveSessionTabId()
    if (!current.client || (!sourceTerminalHandle && !(nativeChatSessionId && nativeChatTabId))) {
      return
    }
    const activationSeq = ++activationSeqRef.current
    openMobileNativeChatFileTap<T>({
      client: current.client,
      hostId: current.hostId,
      worktreeId: current.worktreeId,
      worktreeName: current.worktreeName,
      pathText,
      absolutePathTerminalHandle: sourceTerminalHandle,
      nativeChatContext:
        nativeChatSessionId && nativeChatTabId
          ? { tabId: nativeChatTabId, sessionId: nativeChatSessionId }
          : null,
      pushPreviewRoute: (href) => routerRef.current.push(href),
      openBrowser: current.openBrowser,
      triggerOpenFeedback: triggerSelection,
      fetchSessionTabs: current.fetchSessionTabs,
      getSessionTabs: current.getSessionTabs,
      getActiveSessionTabId: current.getActiveSessionTabId,
      getActivationState: (activated) => ({
        activated,
        activationSeq,
        latestActivationSeq: activationSeqRef.current,
        sourceTerminalHandle,
        activeTerminalHandle: current.activeHandleRef.current,
        sourceSessionTabId: nativeChatTabId,
        activeSessionTabId: current.getActiveSessionTabId(),
        activeTabType: current.getActiveSessionTabType()
      }),
      switchSessionTab: current.switchSessionTab,
      scheduleDelayedAction: current.scheduleDelayedAction,
      onOpenFailed: (failure) => {
        const state = current.client?.getState?.()
        current.reportChatTapFailure(
          describeFileTapOpenFailure(pathText, failure, {
            worktreeName: current.worktreeName,
            connected: state === undefined ? null : state === 'connected'
          })
        )
      },
      offerFileTapMatches: (offer) => {
        matchOfferRef.current = offer
        pickedMatchRef.current = null
        setMatchOffer(offer)
        setMatchPickerVisible(true)
      }
    })
  }, [])

  const pickMatch = useCallback((relativePath: string) => {
    pickedMatchRef.current = relativePath
  }, [])
  const closeMatchPicker = useCallback(() => setMatchPickerVisible(false), [])
  const afterMatchPickerClose = useCallback(() => {
    const offer = matchOfferRef.current
    const picked = pickedMatchRef.current
    matchOfferRef.current = null
    pickedMatchRef.current = null
    setMatchOffer(null)
    // Why after the hide and not on the press: the open can push the preview route, and a route
    // should not change under a sheet still on screen. PickerListDrawer waits out its hide before
    // it selects for the same reason.
    if (offer && picked && offer.paths.includes(picked)) {
      offer.open(picked)
    }
  }, [])
  const fileTapMatchPicker = useMemo(
    () => ({
      offer: matchOffer,
      visible: matchPickerVisible,
      pick: pickMatch,
      close: closeMatchPicker,
      afterClose: afterMatchPickerClose
    }),
    [afterMatchPickerClose, closeMatchPicker, matchOffer, matchPickerVisible, pickMatch]
  )

  return { handleFileTap, handleNativeChatFileTap, fileTapMatchPicker }
}
