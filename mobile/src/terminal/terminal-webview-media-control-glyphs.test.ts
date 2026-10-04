// @vitest-environment happy-dom
// Claude Code's status line says `⏵⏵ auto mode on` (U+23F5). On a Galaxy S23 no system font has the
// triangles U+23F4..U+23F7 (the Noto Symbols subsets Samsung ships stop short of them), so the
// WebView drew two boxes; 9c01356bd saw the same on the Termux engine, and Ghostty drew them from
// the same system chain. The document carries a 6 KB OFL subset of Noto Sans Symbols 2 v2.008. The
// file holds seven code points, U+23F4..U+23FA; the face selects only the four triangles. ⏸ ⏹ ⏺
// (U+23F8..U+23FA) advance 0.91em in that font, half a cell too wide, and ⏺ is the dot Claude Code
// puts on every message row; they drew from the system fonts before the face and still do.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalDocument } from './document/create-terminal-document'
import { createTerminalDocumentScope } from './document/document-scope'
import { terminalDocumentDouble } from './document/document-terminal-double.test-support'
import { startTextScaling } from './document/text-scaling'
import { TERMINAL_DOCUMENT_MARKUP, XTERM_HTML } from './terminal-webview-html'

const FAMILY = 'Noto Sans Symbols 2 Media Controls'
/** Claude Code's `⏵`, the reason the face exists. */
const MEDIA_CONTROL_SAMPLE_CODE_POINT = 0x23f5
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

/** The code points a `unicode-range` value names, for plain ranges and single code points. */
function codePointsInUnicodeRange(range: string): number[] {
  const codePoints: number[] = []
  for (const part of range.split(',')) {
    const match = /^\s*U\+([0-9A-F]+)(?:-([0-9A-F]+))?\s*$/i.exec(part)
    if (!match) {
      throw new Error(`unicode-range part this test cannot read: ${part}`)
    }
    const first = Number.parseInt(match[1], 16)
    const last = match[2] ? Number.parseInt(match[2], 16) : first
    for (let codePoint = first; codePoint <= last; codePoint++) {
      codePoints.push(codePoint)
    }
  }
  return codePoints
}

/**
 * Each code point's advance in a TrueType file, in em, read from its own tables: `head` (units per
 * em), `hhea` and `hmtx` (advances) and the Unicode `cmap` (format 4, which the subset uses). A code
 * point the font does not map is left out.
 */
function advancesInEm(font: Buffer, codePoints: readonly number[]): Map<number, number> {
  const tables = new Map<string, number>()
  const tableCount = font.readUInt16BE(4)
  for (let i = 0; i < tableCount; i++) {
    const record = 12 + i * 16
    tables.set(font.toString('latin1', record, record + 4), font.readUInt32BE(record + 8))
  }
  const table = (tag: string) => {
    const offset = tables.get(tag)
    if (offset === undefined) {
      throw new Error(`font has no ${tag} table`)
    }
    return offset
  }
  const unitsPerEm = font.readUInt16BE(table('head') + 18)
  const metricCount = font.readUInt16BE(table('hhea') + 34)
  const hmtx = table('hmtx')
  const advanceOf = (glyph: number) => font.readUInt16BE(hmtx + Math.min(glyph, metricCount - 1) * 4)

  const cmap = table('cmap')
  let subtable = -1
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const record = cmap + 4 + i * 8
    const platform = font.readUInt16BE(record)
    const encoding = font.readUInt16BE(record + 2)
    if ((platform === 3 && encoding === 1) || (platform === 0 && encoding === 3)) {
      subtable = cmap + font.readUInt32BE(record + 4)
      break
    }
  }
  if (subtable < 0 || font.readUInt16BE(subtable) !== 4) {
    throw new Error('font has no format 4 Unicode cmap')
  }
  const segments = font.readUInt16BE(subtable + 6) / 2
  const ends = subtable + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const rangeOffsets = deltas + segments * 2
  const glyphOf = (codePoint: number) => {
    for (let s = 0; s < segments; s++) {
      if (font.readUInt16BE(ends + s * 2) < codePoint) {
        continue
      }
      const start = font.readUInt16BE(starts + s * 2)
      if (start > codePoint) {
        return 0
      }
      const delta = font.readInt16BE(deltas + s * 2)
      const rangeOffset = font.readUInt16BE(rangeOffsets + s * 2)
      if (rangeOffset === 0) {
        return (codePoint + delta) & 0xffff
      }
      const glyph = font.readUInt16BE(rangeOffsets + s * 2 + rangeOffset + (codePoint - start) * 2)
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff
    }
    return 0
  }

  const advances = new Map<number, number>()
  for (const codePoint of codePoints) {
    const glyph = glyphOf(codePoint)
    if (glyph !== 0) {
      advances.set(codePoint, advanceOf(glyph) / unitsPerEm)
    }
  }
  return advances
}

/**
 * The narrowest cell the terminal's font stack gives a glyph: monospace faces advance about 0.6em
 * (measured: Menlo 1233/2048, Andale Mono 1229/2048, SF Mono 1266/2048). xterm lays every
 * single-width glyph into one cell and draws whatever is wider over the next one.
 */
const NARROWEST_TERMINAL_CELL_EM = 0.6

function mediaControlFace(): Map<string, string> {
  const faces = fontFaceRules(XTERM_HTML).filter(
    (rule) => rule.get('font-family') === `"${FAMILY}"`
  )
  expect(faces).toHaveLength(1)
  return faces[0]
}

describe("Claude Code's ⏵⏵ in the WebView terminal", () => {
  it('ships the media-control glyphs as a face only U+23F4..U+23F7 can select', () => {
    const face = mediaControlFace()
    expect(face.get('unicode-range')).toBe('U+23F4-23F7')
    const src = face.get('src') ?? ''
    const data = /^url\(data:font\/ttf;base64,([A-Za-z0-9+/=]+)\) format\('truetype'\)$/.exec(src)
    expect(data).not.toBeNull()
    // The embedded copy is the vendored file, byte for byte, so the two cannot drift.
    expect(Buffer.from(data![1], 'base64').equals(readFileSync(FONT_FILE))).toBe(true)
  })

  // Read from the range the WebView is actually given, so widening it again fails here.
  it('never draws a glyph wider than its cell from the bundled face', () => {
    const selectable = codePointsInUnicodeRange(mediaControlFace().get('unicode-range') ?? '')
    const advances = advancesInEm(readFileSync(FONT_FILE), selectable)

    const tooWide = [...advances]
      .filter(([, advance]) => advance > NARROWEST_TERMINAL_CELL_EM)
      .map(([codePoint, advance]) => `U+${codePoint.toString(16).toUpperCase()} ${advance}em`)
    expect(tooWide).toEqual([])
    // The face still supplies every code point it can select, `⏵` first among them.
    expect([...advances.keys()]).toEqual(selectable)
    expect(selectable).toContain(MEDIA_CONTROL_SAMPLE_CODE_POINT)
  })

  it("leaves Claude Code's ⏺ message dot, ⏸ and ⏹ to the system fonts", () => {
    const selectable = codePointsInUnicodeRange(mediaControlFace().get('unicode-range') ?? '')

    for (const glyph of ['⏸', '⏹', '⏺']) {
      expect(selectable).not.toContain(glyph.codePointAt(0))
    }
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
