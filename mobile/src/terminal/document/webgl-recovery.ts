import {
  MEDIA_CONTROL_GLYPHS_FONT_FAMILY,
  MEDIA_CONTROL_GLYPHS_SAMPLE
} from '../terminal-media-control-glyphs'
import { flog } from './viewport-transform'
import { applyTerminalTheme } from './terminal-theme'
import type { TerminalDocumentScope, TerminalDocumentWebglAddon } from './document-scope'

export function refreshTerminalSurface(scope: TerminalDocumentScope) {
  if (!scope.term) {
    return
  }
  try {
    scope.term.refresh(0, Math.max(0, scope.term.rows - 1))
  } catch {}
}

export function cancelWebglContextRecovery(scope: TerminalDocumentScope) {
  if (!scope.webglRecoveryTimer) {
    return
  }
  clearTimeout(scope.webglRecoveryTimer)
  scope.webglRecoveryTimer = null
}

export function attachWebglAddon(scope: TerminalDocumentScope, allowRecovery: boolean) {
  if (!scope.term) {
    return false
  }
  let addon: TerminalDocumentWebglAddon | null = null
  try {
    addon = scope.createWebglAddon()
    // Why: no addon is the DOM renderer, which is a fallback rather than a failure; the
    // catch below is for an engine that has one and threw building it.
    if (!addon) {
      return false
    }
    scope.webglAddon = addon
    if (addon.onContextLoss) {
      addon.onContextLoss(function () {
        if (scope.webglAddon !== addon) {
          return
        }
        flog(scope, 'webgl-context-loss', { retry: allowRecovery })
        scope.webglAddon = null
        try {
          addon!.dispose()
        } catch {}
        refreshTerminalSurface(scope)
        if (!allowRecovery) {
          return
        }
        // Why: one delayed retry handles transient iOS context loss without
        // entering a GPU crash loop; a second loss stays on the DOM renderer.
        cancelWebglContextRecovery(scope)
        const recoveryTerm = scope.term
        const recoveryGeneration = scope.terminalGeneration
        scope.webglRecoveryTimer = setTimeout(function () {
          scope.webglRecoveryTimer = null
          if (scope.term !== recoveryTerm || scope.terminalGeneration !== recoveryGeneration) {
            return
          }
          attachWebglAddon(scope, false)
        }, 100)
      })
    }
    scope.term.loadAddon(addon)
    if (!allowRecovery) {
      try {
        if (addon.clearTextureAtlas) {
          addon.clearTextureAtlas()
        }
      } catch {}
      refreshTerminalSurface(scope)
    }
    return true
  } catch (e) {
    flog(scope, 'webgl-attach-failed', { retry: !allowRecovery, message: String(e) })
    if (scope.webglAddon === addon) {
      scope.webglAddon = null
    }
    try {
      if (addon) {
        addon.dispose()
      }
    } catch {}
    refreshTerminalSurface(scope)
    return false
  }
}

function onDocumentVisibilityChange(scope: TerminalDocumentScope) {
  if (document.visibilityState !== 'visible') {
    return
  }
  // Why: iOS may restore the xterm model while discarding GPU pixels/theme
  // paint state, so visibility must rebuild the atlas and repaint every row.
  applyTerminalTheme(scope, scope.terminalThemeInput)
  try {
    if (scope.webglAddon && scope.webglAddon.clearTextureAtlas) {
      scope.webglAddon.clearTextureAtlas()
    }
  } catch {}
  refreshTerminalSurface(scope)
}

/**
 * Code UI: rebuild the atlas once the media-control face has loaded.
 *
 * The WebGL renderer rasterises a glyph once and keeps it in its atlas. The face is behind a
 * unicode-range and a data URI, both of which load asynchronously, so Claude Code's first `⏵`
 * would be drawn from the fallback (a box on a Galaxy S23) and kept. Asking for the face here
 * starts the load before the first snapshot paints, and the atlas is rebuilt when it lands. On the
 * page, which declares no such face, the load answers no faces and nothing is redrawn.
 */
function redrawWhenMediaControlFaceLoads(scope: TerminalDocumentScope, isStopped: () => boolean) {
  const fonts = typeof document === 'undefined' ? undefined : document.fonts
  if (!fonts || typeof fonts.load !== 'function') {
    return
  }
  fonts.load('13px "' + MEDIA_CONTROL_GLYPHS_FONT_FAMILY + '"', MEDIA_CONTROL_GLYPHS_SAMPLE).then(
    function (faces) {
      if (isStopped() || faces.length === 0) {
        return
      }
      try {
        if (scope.webglAddon && scope.webglAddon.clearTextureAtlas) {
          scope.webglAddon.clearTextureAtlas()
        }
      } catch {}
      refreshTerminalSurface(scope)
    },
    function () {}
  )
}

export function startWebglRecovery(scope: TerminalDocumentScope) {
  const onVisibilityChange = () => onDocumentVisibilityChange(scope)
  document.addEventListener('visibilitychange', onVisibilityChange)
  let stopped = false
  scope.removeWebglRecovery = () => {
    stopped = true
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
  redrawWhenMediaControlFaceLoads(scope, () => stopped)
}

export function stopWebglRecovery(scope: TerminalDocumentScope) {
  if (scope.removeWebglRecovery) {
    scope.removeWebglRecovery()
    scope.removeWebglRecovery = null
  }
  cancelWebglContextRecovery(scope)
}
