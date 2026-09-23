import { enqueueWriteBoundary } from './write-queue'
import { notify } from './host-notify'
import type {
  TerminalDocumentDisposable,
  TerminalDocumentParser,
  TerminalDocumentScope,
  TerminalDocumentTerminal,
  TerminalDocumentTerminalOptions
} from './document-scope'

/**
 * The gate deciding when xterm's parser replies may reach the native host.
 *
 * One unit so the tests exercise the same replay and generation gate the document runs rather than
 * a re-implementation of it — which was already the reason this was one injected string.
 */
export type QueryReplyTerminal = {
  attachCustomKeyEventHandler: (handler: () => boolean) => void
  textarea?: {
    readOnly: boolean
    tabIndex: number
    setAttribute: (name: string, value: string) => void
  }
  onData: (listener: (data: string) => void) => TerminalDocumentDisposable
  parser: TerminalDocumentParser
} & DecrqmTerminal

/** The terminal state a DECRQM answer reads: public modes, two options, two core services. */
export type DecrqmTerminal = Partial<
  Pick<TerminalDocumentTerminal, 'modes' | 'options' | '_core' | 'buffer'>
>

export function resetTerminalDataReplyAuthority(scope: TerminalDocumentScope) {
  scope.terminalDataRepliesEnabled = false
}

export function resumeTerminalDataReplyAuthority(scope: TerminalDocumentScope) {
  scope.terminalDataRepliesEnabled = true
}

export function forwardTerminalDataReply(scope: TerminalDocumentScope, data: string) {
  if (scope.terminalDataRepliesEnabled) {
    notify(scope, { type: 'terminal-data', bytes: data })
  }
}

export function enqueueTerminalDataReplyBoundary(scope: TerminalDocumentScope, gen: number) {
  enqueueWriteBoundary(scope, function () {
    if (gen === scope.terminalGeneration) {
      scope.terminalDataRepliesEnabled = true
    }
  })
}

// DECRPM values: 0 not recognized, 1 set, 2 reset, 3 permanently set, 4 permanently reset.
export function decrqmModeState(term: DecrqmTerminal, isPrivate: boolean, mode: number) {
  const modes = term.modes || {}
  const options: Partial<TerminalDocumentTerminalOptions> = term.options || {}
  const core = term._core || {}
  const coreService = core.coreService || {}
  const mouse = core.coreMouseService || {}
  const flag = function (on: boolean | undefined) {
    return on ? 1 : 2
  }
  if (!isPrivate) {
    if (mode === 2) {
      return 4
    }
    if (mode === 4) {
      return flag(modes.insertMode)
    }
    if (mode === 12) {
      return 3
    }
    if (mode === 20) {
      return flag(options.convertEol)
    }
    return 0
  }
  switch (mode) {
    case 1:
      return flag(modes.applicationCursorKeysMode)
    case 6:
      return flag(modes.originMode)
    case 7:
      return flag(modes.wraparoundMode)
    case 8:
      return 3
    case 9:
      return flag(modes.mouseTrackingMode === 'x10')
    case 12:
      return flag(options.cursorBlink)
    case 25:
      return flag(!coreService.isCursorHidden)
    case 45:
      return flag(modes.reverseWraparoundMode)
    case 66:
      return flag(modes.applicationKeypadMode)
    case 1000:
      return flag(modes.mouseTrackingMode === 'vt200')
    case 1002:
      return flag(modes.mouseTrackingMode === 'drag')
    case 1003:
      return flag(modes.mouseTrackingMode === 'any')
    case 1004:
      return flag(modes.sendFocusMode)
    case 1006:
      return flag(mouse.activeEncoding === 'SGR')
    case 1016:
      return flag(mouse.activeEncoding === 'SGR_PIXELS')
    case 47:
    case 1047:
    case 1049:
      return flag(term.buffer && term.buffer.active && term.buffer.active.type === 'alternate')
    case 2004:
      return flag(modes.bracketedPasteMode)
    case 2026:
      return flag(modes.synchronizedOutputMode)
    default:
      return 0
  }
}

export function attachTerminalQueryReplyBridge(
  scope: TerminalDocumentScope,
  term: QueryReplyTerminal,
  gen: number
) {
  // Why: parser replies require stdin enabled, but mobile input is owned by
  // native controls. Keep xterm's textarea inert for touch/hardware keys.
  try {
    term.attachCustomKeyEventHandler(function () {
      return false
    })
    if (term.textarea) {
      term.textarea.readOnly = true
      term.textarea.tabIndex = -1
      term.textarea.setAttribute('inputmode', 'none')
    }
  } catch {}
  try {
    scope.termObserverDisposables.push(
      term.onData(function (data) {
        forwardTerminalDataReply(scope, data)
      })
    )
  } catch {}
  // Why: xterm 6.1.0-beta.303's built-in DECRQM handler assigns to an undeclared
  // enum variable and throws ReferenceError under strict mode, which killed the
  // engine the moment OpenCode or Antigravity asked "CSI ? 2026 $ p" at startup.
  // Custom CSI handlers run before the built-in one, so answer DECRQM here from
  // xterm's public mode state and stop the built-in from running.
  try {
    const answerRequestMode = function (isPrivate: boolean, params: (number | number[])[]) {
      const mode = Array.isArray(params[0]) ? params[0][0] : params[0]
      if (typeof mode !== 'number') {
        return true
      }
      const value = decrqmModeState(term, isPrivate, mode)
      forwardTerminalDataReply(
        scope,
        '\u001b[' + (isPrivate ? '?' : '') + mode + ';' + value + '$y'
      )
      return true
    }
    scope.termObserverDisposables.push(
      term.parser.registerCsiHandler(
        { prefix: '?', intermediates: '$', final: 'p' },
        function (params) {
          return answerRequestMode(true, params)
        }
      )
    )
    scope.termObserverDisposables.push(
      term.parser.registerCsiHandler({ intermediates: '$', final: 'p' }, function (params) {
        return answerRequestMode(false, params)
      })
    )
  } catch {}
  // Why: live output can queue before initial replay finishes. Enable replies
  // at the replay boundary so those live queries are answered, never replayed ones.
  enqueueTerminalDataReplyBoundary(scope, gen)
}
