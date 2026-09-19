import { hookScreenMount } from '../mounted-screen-tree'
import { mountFixture } from '../recorder-fixture-shape'
import type { operationModuleLoader } from '../operation-module-loader'
import type { MountAdapter } from '../recording-scenario'
import type { TerminalModes } from '../../../terminal/terminal-webview-contract'
import type {
  Terminal,
  TerminalGestureInputQueue
} from '../../../session/mobile-session-route-types'

const HANDLE = 'terminal-1'
const DEVICE_TOKEN = 'device-token-1'
/** A two-finger scroll as the WebView bridge reports it: one SGR wheel sequence. */
const WHEEL_REPORT = '[<64;10;5M'
/** Mouse reporting on, alt screen off: the gate a gesture byte has to pass to reach the wire. */
const PTY_MODES: TerminalModes = {
  bracketedPasteMode: false,
  altScreen: false,
  mouseTrackingMode: 'any',
  sgrMouseMode: true,
  sgrMousePixelsMode: false
}

/**
 * The two sends the session screen's gesture surface makes: the debounced flush of buffered wheel
 * and arrow reports, and the clear-buffer the terminal menu issues.
 *
 * Neither rides a subscription. The flush reads refs — client, connection state, PTY modes, the
 * gesture buckets, the active handle and tab type — and the clear optional-chains the webview, so a
 * mount holding no terminal ref reaches both. The webview is absent rather than substituted: the
 * local `clear()` on it is a device call this oracle has no observation of, and the send after it is
 * what the recording is evidence of.
 *
 * State is the queue accounting the hook owns — what is buffered and what is in flight — because
 * that is the hook's own value; it returns callbacks and nothing else. A refused clear lands as a
 * toast in the effects.
 *
 * CODE UI: this fork's gesture model differs from upstream's — wheel rows pipeline one sequence
 * per 16 ms flush with an in-flight count per handle and no token bucket, and the send reports no
 * worker takeover (no orchestration workers here) — so the refs below are this fork's and the
 * projected state names its queue.
 */
export function sessionTerminalGestureMountAdapters(
  modules: ReturnType<typeof operationModuleLoader>
): Record<string, MountAdapter> {
  return {
    'session.terminal-gesture-input': ({ client, effect }) => {
      const useTerminalInput = modules.load<
        typeof import('../../../session/use-mobile-session-terminal-input')
      >('mobile/src/session/use-mobile-session-terminal-input.ts').useMobileSessionTerminalInput
      const queues = { current: new Map<string, TerminalGestureInputQueue>() }
      const inFlight = { current: new Map<string, number>() }
      let input: ReturnType<typeof useTerminalInput> | undefined
      const screen = hookScreenMount(() => {
        input = useTerminalInput(
          mountFixture<Parameters<typeof useTerminalInput>[0]>({
            client,
            connState: 'connected',
            activeHandle: HANDLE,
            clientRef: { current: client },
            connStateRef: { current: 'connected' },
            deviceTokenRef: { current: DEVICE_TOKEN },
            activeHandleRef: { current: HANDLE },
            activeSessionTabTypeRef: { current: 'terminal' },
            ptyModesRef: { current: new Map([[HANDLE, PTY_MODES]]) },
            terminalGestureInputQueuesRef: queues,
            terminalGestureInputInFlightRef: inFlight,
            liveInputRef: { current: null },
            liveInputFocusTimerRef: { current: null },
            terminalUnsubsRef: { current: new Map() },
            hostQueryReplyInputSupportedRef: { current: false },
            hostPlatformRef: { current: null },
            clearPendingLiveInputCommit: () => {},
            toggleTerminalLiveInput: () => false,
            getTerminalRef: () => undefined,
            showToast: (message: string, durationMs?: number) =>
              effect('toast', { message, durationMs: durationMs ?? null })
          })
        )
      }, effect)

      return {
        action(name, args) {
          if (name === 'mount') {
            return screen.mount()
          }
          if (name === 'gesture') {
            return input!.handleTerminalInput(HANDLE, String(args.bytes ?? WHEEL_REPORT))
          }
          if (name === 'clear') {
            const target: Terminal = { handle: HANDLE, title: 'zsh', isActive: true }
            return input!.handleClearTerminal(target)
          }
          throw new Error(`Unknown terminal gesture action: ${name}`)
        },
        state: () => ({
          queuedSequences: queues.current.get(HANDLE)?.sequences.length ?? null,
          queuedBytes: queues.current.get(HANDLE)?.sequences.join('') ?? null,
          inFlight: inFlight.current.get(HANDLE) ?? 0,
          crash: screen.crash()
        }),
        dispose: () => {
          screen.unmount()
        }
      }
    }
  }
}
