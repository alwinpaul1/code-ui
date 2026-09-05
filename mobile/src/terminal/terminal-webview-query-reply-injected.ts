// Kept as one injectable unit so tests execute the same replay/generation gate
// that the WebView document runs, rather than a TypeScript reimplementation.
export const TERMINAL_QUERY_REPLY_JS = `
  var terminalDataRepliesEnabled = false;

  function resetTerminalDataReplyAuthority() {
    terminalDataRepliesEnabled = false;
  }

  function resumeTerminalDataReplyAuthority() {
    terminalDataRepliesEnabled = true;
  }

  function forwardTerminalDataReply(data) {
    if (terminalDataRepliesEnabled) notify({ type: 'terminal-data', bytes: data });
  }

  function enqueueTerminalDataReplyBoundary(gen) {
    enqueueWriteBoundary(function() {
      if (gen === terminalGeneration) terminalDataRepliesEnabled = true;
    });
  }

  // DECRPM values: 0 not recognized, 1 set, 2 reset, 3 permanently set, 4 permanently reset.
  function decrqmModeState(term, isPrivate, mode) {
    var modes = term.modes || {};
    var options = term.options || {};
    var core = term._core || {};
    var coreService = core.coreService || {};
    var mouse = core.coreMouseService || {};
    var flag = function(on) { return on ? 1 : 2; };
    if (!isPrivate) {
      if (mode === 2) return 4;
      if (mode === 4) return flag(modes.insertMode);
      if (mode === 12) return 3;
      if (mode === 20) return flag(options.convertEol);
      return 0;
    }
    switch (mode) {
      case 1: return flag(modes.applicationCursorKeysMode);
      case 6: return flag(modes.originMode);
      case 7: return flag(modes.wraparoundMode);
      case 8: return 3;
      case 9: return flag(modes.mouseTrackingMode === 'x10');
      case 12: return flag(options.cursorBlink);
      case 25: return flag(!coreService.isCursorHidden);
      case 45: return flag(modes.reverseWraparoundMode);
      case 66: return flag(modes.applicationKeypadMode);
      case 1000: return flag(modes.mouseTrackingMode === 'vt200');
      case 1002: return flag(modes.mouseTrackingMode === 'drag');
      case 1003: return flag(modes.mouseTrackingMode === 'any');
      case 1004: return flag(modes.sendFocusMode);
      case 1006: return flag(mouse.activeEncoding === 'SGR');
      case 1016: return flag(mouse.activeEncoding === 'SGR_PIXELS');
      case 47: case 1047: case 1049:
        return flag(term.buffer && term.buffer.active && term.buffer.active.type === 'alternate');
      case 2004: return flag(modes.bracketedPasteMode);
      case 2026: return flag(modes.synchronizedOutputMode);
      default: return 0;
    }
  }

  function attachTerminalQueryReplyBridge(term, gen) {
    // Why: parser replies require stdin enabled, but mobile input is owned by
    // native controls. Keep xterm's textarea inert for touch/hardware keys.
    try {
      term.attachCustomKeyEventHandler(function() { return false; });
      if (term.textarea) {
        term.textarea.readOnly = true;
        term.textarea.tabIndex = -1;
        term.textarea.setAttribute('inputmode', 'none');
      }
    } catch (e) {}
    try {
      termObserverDisposables.push(term.onData(function(data) {
        forwardTerminalDataReply(data);
      }));
    } catch (e) {}
    // Why: xterm 6.1.0-beta.303's built-in DECRQM handler assigns to an undeclared
    // enum variable and throws ReferenceError under strict mode, which killed the
    // engine the moment OpenCode or Antigravity asked "CSI ? 2026 $ p" at startup.
    // Custom CSI handlers run before the built-in one, so answer DECRQM here from
    // xterm's public mode state and stop the built-in from running.
    try {
      var answerRequestMode = function(isPrivate, params) {
        var mode = Array.isArray(params[0]) ? params[0][0] : params[0];
        if (typeof mode !== 'number') return true;
        var value = decrqmModeState(term, isPrivate, mode);
        forwardTerminalDataReply('\u001b[' + (isPrivate ? '?' : '') + mode + ';' + value + '$y');
        return true;
      };
      termObserverDisposables.push(term.parser.registerCsiHandler(
        { prefix: '?', intermediates: '$', final: 'p' },
        function(params) { return answerRequestMode(true, params); }
      ));
      termObserverDisposables.push(term.parser.registerCsiHandler(
        { intermediates: '$', final: 'p' },
        function(params) { return answerRequestMode(false, params); }
      ));
    } catch (e) {}
    // Why: live output can queue before initial replay finishes. Enable replies
    // at the replay boundary so those live queries are answered, never replayed ones.
    enqueueTerminalDataReplyBoundary(gen);
  }
`
