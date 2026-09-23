// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createTerminalDocumentScope } from './document/document-scope'
import { clampPan, startFitScale, stopFitScale } from './document/fit-scale'
import { applyTerminalTheme } from './document/terminal-theme'
import { terminalDocumentDouble } from './document/document-terminal-double.test-support'

// Two of this fork's terminal behaviours whose only guard was the byte golden and the payload
// hash, which #21878 (e68ccb30) retired: the theme-key skip, and the resize invalidation of the
// cached surface metrics (fork 7097feea). Removed, either one left every other terminal and session
// suite green (batch E review, 2026-09-23). Each case here fails with its behaviour removed.

describe('the terminal theme', () => {
  it('does not repaint when the host re-sends the theme it already sent', () => {
    const scope = createTerminalDocumentScope({ paintDocumentBackground: () => {} })
    scope.defaultTheme = { background: '#1a1b26', foreground: '#c0caf5' }
    let themeWrites = 0
    let theme: unknown
    const options = { minimumContrastRatio: 3 }
    Object.defineProperty(options, 'theme', {
      get: () => theme,
      set: (value) => {
        themeWrites += 1
        theme = value
      }
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the members applyTerminalTheme writes
    scope.term = { options } as unknown as typeof scope.term
    applyTerminalTheme(scope, { theme: { background: '#000000' } })
    // Equal, not identical: the host builds a fresh object per snapshot.
    applyTerminalTheme(scope, { theme: { background: '#000000' } })
    applyTerminalTheme(scope, { theme: { background: '#000000' } })
    expect(themeWrites).toBe(1)
    applyTerminalTheme(scope, { theme: { background: '#ffffff' } })
    expect(themeWrites).toBe(2)
  })
})

describe('the cached surface metrics', () => {
  let scope: ReturnType<typeof createTerminalDocumentScope> | null = null
  afterEach(() => {
    if (scope) {
      stopFitScale(scope)
    }
    scope = null
  })

  it('re-measures the viewport on a window resize, so the pan is clamped to the new width', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    scope = createTerminalDocumentScope({})
    const { terminal } = terminalDocumentDouble()
    const host = document.createElement('div')
    Object.defineProperty(host, 'scrollWidth', { configurable: true, value: 900 })
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 300 })
    terminal.open(host)
    scope.term = terminal
    scope.surface = document.createElement('div')
    startFitScale(scope)
    // A pan at the far right of 900px of content in a 400px window, measured and cached.
    scope.panX = -1000
    clampPan(scope)
    expect(scope.panX).toBe(-500)
    // The window widens (rotation, keyboard, split screen): the far right is now -100.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    window.dispatchEvent(new Event('resize'))
    expect(scope.panX).toBe(-100)
    expect(scope.surface.style.transform).toContain('translate(-100px,0px)')
  })
})
