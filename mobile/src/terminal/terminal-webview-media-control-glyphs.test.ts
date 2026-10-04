// @vitest-environment happy-dom
// Claude Code's status line says `⏵⏵ auto mode on` (U+23F5). On a Galaxy S23 no system font has the
// media-control block U+23F4..U+23FA (the Noto Symbols subsets Samsung ships stop short of it), so
// the WebView drew two boxes; 9c01356bd saw the same on the Termux engine, and Ghostty drew them
// from the same system chain. The document now carries a 6 KB OFL subset of Noto Sans Symbols 2
// v2.008 holding exactly those seven code points, as a face only those code points can select.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalDocument } from './document/create-terminal-document'
import { createTerminalDocumentScope } from './document/document-scope'
import { terminalDocumentDouble } from './document/document-terminal-double.test-support'
import { startTextScaling } from './document/text-scaling'
import { TERMINAL_DOCUMENT_MARKUP, XTERM_HTML } from './terminal-webview-html'

const FAMILY = 'Noto Sans Symbols 2 Media Controls'
const FONT_FILE = join(
  import.meta.dirname,
  'terminal-webview-html',
  'fonts',
  'NotoSansSymbols2-MediaControls.ttf'
)

/**
 * Every `@font-face { … }` rule in the HTML the WebView loads, as its declarations. Read per
 * property rather than split on `;`, because a data URI carries one (`data:font/ttf;base64,`).
 */
function fontFaceRules(html: string): Map<string, string>[] {
  const rules: Map<string, string>[] = []
  const pattern = /@font-face\s*\{([^}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const body = match[1]
    const declarations = new Map<string, string>()
    for (const property of ['font-family', 'src', 'unicode-range']) {
      const value = new RegExp(`(?:^|\\s)${property}:\\s*((?:url\\([^)]*\\)|[^;])+);`).exec(body)
      if (value) {
        declarations.set(property, value[1].trim())
      }
    }
    rules.push(declarations)
  }
  return rules
}

function fontFamilyFor(navigatorValue: { userAgent: string; platform: string; maxTouchPoints: number }) {
  document.body.innerHTML = TERMINAL_DOCUMENT_MARKUP
  vi.stubGlobal('navigator', navigatorValue)
  try {
    const scope = createTerminalDocumentScope()
    startTextScaling(scope)
    return scope.terminalFontFamily
  } finally {
    vi.unstubAllGlobals()
  }
}

describe("Claude Code's ⏵⏵ in the WebView terminal", () => {
  it('ships the media-control glyphs as a face only U+23F4..U+23FA can select', () => {
    const faces = fontFaceRules(XTERM_HTML).filter(
      (rule) => rule.get('font-family') === `"${FAMILY}"`
    )
    expect(faces).toHaveLength(1)
    const face = faces[0]
    expect(face.get('unicode-range')).toBe('U+23F4-23FA')
    const src = face.get('src') ?? ''
    const data = /^url\(data:font\/ttf;base64,([A-Za-z0-9+/=]+)\) format\('truetype'\)$/.exec(src)
    expect(data).not.toBeNull()
    // The embedded copy is the vendored file, byte for byte, so the two cannot drift.
    expect(Buffer.from(data![1], 'base64').equals(readFileSync(FONT_FILE))).toBe(true)
  })

  it('names the face in the terminal font stack, ahead of the generic monospace', () => {
    const android = fontFamilyFor({
      userAgent: 'Mozilla/5.0 (Linux; Android 16)',
      platform: 'Linux armv8l',
      maxTouchPoints: 5
    })
    const ios = fontFamilyFor({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
      platform: 'iPhone',
      maxTouchPoints: 5
    })
    for (const stack of [android, ios]) {
      expect(stack.endsWith(`"${FAMILY}", monospace`)).toBe(true)
    }
  })
})

// The WebGL renderer rasterises each glyph once into a texture atlas and keeps it. A face behind a
// unicode-range loads lazily, and a data URI still loads asynchronously, so the first `⏵` would be
// drawn from the fallback (a box) and cached. The document asks for the face as it starts and
// rebuilds the atlas once the face has arrived.
describe('the glyph atlas and the bundled face', () => {
  let load: ReturnType<typeof vi.fn>
  let resolveLoad: (faces: unknown[]) => void

  beforeEach(() => {
    load = vi.fn(
      () =>
        new Promise<unknown[]>((resolve) => {
          resolveLoad = resolve
        })
    )
    Object.defineProperty(document, 'fonts', { value: { load }, configurable: true })
  })

  afterEach(() => {
    Reflect.deleteProperty(document, 'fonts')
    document.body.innerHTML = ''
  })

  function startDocument() {
    const host = document.createElement('div')
    host.innerHTML = TERMINAL_DOCUMENT_MARKUP
    document.body.appendChild(host)
    const engine = terminalDocumentDouble()
    const refresh = vi.spyOn(engine.terminal, 'refresh')
    const clearTextureAtlas = vi.fn()
    const started = createTerminalDocument({
      root: host,
      postToHost: () => {},
      hasEngine: () => true,
      installHostTransport: () => () => {},
      installErrorReporter: () => () => {},
      paintDocumentBackground: () => {},
      createTerminal: () => engine.terminal,
      createUnicode11Addon: () => null,
      createWebglAddon: () => ({ clearTextureAtlas, dispose() {} })
    })
    started.send({ type: 'init', cols: 80, rows: 24, initialData: '⏵⏵ auto mode on' })
    return { started, refresh, clearTextureAtlas }
  }

  it("asks for the face as the document starts, with Claude Code's glyph", () => {
    const { started } = startDocument()
    expect(load).toHaveBeenCalledWith(expect.stringContaining(`"${FAMILY}"`), '⏵')
    started.stop()
  })

  it('rebuilds the atlas and repaints once the face has loaded', async () => {
    const { started, refresh, clearTextureAtlas } = startDocument()
    refresh.mockClear()

    resolveLoad([{ family: FAMILY }])
    await Promise.resolve()
    await Promise.resolve()

    expect(clearTextureAtlas).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalled()
    started.stop()
  })

  it('leaves the atlas alone when no face loaded (the page, which carries no face)', async () => {
    const { started, clearTextureAtlas } = startDocument()

    resolveLoad([])
    await Promise.resolve()
    await Promise.resolve()

    expect(clearTextureAtlas).not.toHaveBeenCalled()
    started.stop()
  })

  it('does not touch a document that has stopped by the time the face arrives', async () => {
    const { started, clearTextureAtlas } = startDocument()
    started.stop()

    resolveLoad([{ family: FAMILY }])
    await Promise.resolve()
    await Promise.resolve()

    expect(clearTextureAtlas).not.toHaveBeenCalled()
  })

  it('starts without the font API (an older WebView)', () => {
    Reflect.deleteProperty(document, 'fonts')
    const { started } = startDocument()
    started.stop()
  })
})
