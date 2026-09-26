import { all, createLowlight } from 'lowlight'
import { VENDORED_GRAMMARS } from '../components/syntax-grammars'
import { detectMobileFileLanguage, isUnknownMobileFileName } from './mobile-file-language'
import {
  kindsForText,
  scopeForClasses,
  type MobileSyntaxScope,
  type MobileSyntaxTokenKind
} from './mobile-syntax-token-kinds'

export type { MobileSyntaxTokenKind } from './mobile-syntax-token-kinds'

export type MobileSyntaxSegment = {
  text: string
  kind: MobileSyntaxTokenKind
}

export type MobileHighlightedDiffLine<TLine> = TLine & {
  segments: MobileSyntaxSegment[]
  highlighted: boolean
}

type LowlightNode = {
  type: string
  value?: string
  properties?: {
    className?: unknown
  }
  children?: LowlightNode[]
}

type Lowlight = ReturnType<typeof createLowlight>

let lowlightInstance: Lowlight | null = null

/**
 * Every grammar highlight.js ships (lowlight's `all`, 192) and the five it
 * does not (syntax-grammars/), so a file in any of them is coloured, not
 * only the 37 of `common` (reported 2026-09-26: .tex, Dockerfile and .toml
 * drew plain). Their code was in the bundle already: lowlight's one entry
 * re-exports `all`, and Metro does not tree-shake. Registering them all is
 * what costs, 25 ms cold under Node against 11 for `common`, so it is paid on
 * the first highlight rather than at app start.
 */
function highlighter(): Lowlight {
  if (!lowlightInstance) {
    lowlightInstance = createLowlight(all)
    lowlightInstance.register(VENDORED_GRAMMARS)
  }
  return lowlightInstance
}
const MAX_FILE_HIGHLIGHT_CHARS = 48_000
const MAX_FILE_HIGHLIGHT_SEGMENTS = 3_000
const MAX_DIFF_HIGHLIGHT_CHARS = 24_000
const MAX_DIFF_HIGHLIGHT_LINES = 500
const MAX_DIFF_HIGHLIGHT_SEGMENTS = 4_000
const MAX_DIFF_LINE_HIGHLIGHT_SEGMENTS = 96

const LANGUAGE_ALIASES: Record<string, string> = {
  javascriptreact: 'javascript',
  jsx: 'javascript',
  typescriptreact: 'typescript',
  tsx: 'typescript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  fish: 'bash',
  yml: 'yaml'
}

export function resolveMobileSyntaxLanguage(filePath: string, preferredLanguage?: string): string {
  const detected = detectMobileFileLanguage(filePath, preferredLanguage)
  const normalized = LANGUAGE_ALIASES[detected] ?? detected
  return highlighter().registered(normalized) ? normalized : 'plaintext'
}

/** JSON is recognised by parsing it whole; past this it is left plain. */
const MAX_JSON_DETECT_CHARS = 2_000_000
/** Commands that run another program named after them: `npx tsx`,
 *  `pnpm dlx tsx`, `bunx ts-node`. */
const RUNNERS = new Set(['npx', 'bunx', 'pnpx', 'pnpm', 'yarn', 'dlx', 'exec', 'run'])

/**
 * The language a `#!` line runs: the interpreter's name, past `env`, its
 * flags (`-S`) and variables (`NODE_OPTIONS=…`), and past a package runner
 * (`npx tsx` runs tsx). `#!/usr/bin/env -S uv run --script` is Python.
 * Null for an interpreter it does not know.
 */
function shebangLanguage(firstLine: string): string | null {
  const words = firstLine.slice(2).trim().split(/\s+/)
  let at = 0
  const basename = (word: string) => word.slice(word.lastIndexOf('/') + 1)
  if (basename(words[0] ?? '') === 'env') {
    at = 1
  }
  while (at < words.length) {
    const word = basename(words[at]!)
    if (word.startsWith('-') || word.includes('=') || RUNNERS.has(word)) {
      at += 1
      continue
    }
    // python3.11 runs python; an own entry only, so `constructor` is not one.
    const name = [word.replace(/[\d.]+$/, ''), word].find((key) => Object.hasOwn(SHEBANG_LANGUAGES, key))
    return name ? SHEBANG_LANGUAGES[name]! : null
  }
  return null
}

/** Interpreters named on a `#!` line, by the language they run. */
const SHEBANG_LANGUAGES: Record<string, string> = {
  sh: 'bash', bash: 'bash', zsh: 'bash', dash: 'bash', ksh: 'bash', fish: 'bash',
  python: 'python', python2: 'python', python3: 'python',
  node: 'javascript', nodejs: 'javascript',
  deno: 'typescript', bun: 'typescript', tsx: 'typescript', 'ts-node': 'typescript',
  ruby: 'ruby', perl: 'perl', php: 'php', lua: 'lua', Rscript: 'r',
  pwsh: 'powershell', powershell: 'powershell', make: 'makefile', awk: 'awk',
  gawk: 'awk', tclsh: 'tcl', osascript: 'applescript', groovy: 'groovy',
  julia: 'julia', elixir: 'elixir', escript: 'erlang', runhaskell: 'haskell',
  scala: 'scala', crystal: 'crystal', swift: 'swift',
  // `uv run` runs a Python script.
  uv: 'python'
}

/**
 * A language for text whose name says nothing (`bin/deploy`, `run.xyz`, a
 * `.m` that may be Objective-C or MATLAB), read from what the text itself
 * declares: its `#!` line, JSON that parses, an XML or HTML prolog, the
 * marks of a `.m`. Null otherwise, so the file stays plain rather than
 * coloured as the wrong language. highlight.js's relevance is not asked:
 * on real files it was confidently wrong (review, 2026-09-27): lcov.info
 * scored 301 as a Makefile, 4x its runner-up, TokenizeUtil.js.flow 90 as
 * Rust, Paper.idl 96 as ini, while a YAML workflow's right answer scored
 * 138 at 1.8x, and 173 characters of notes came out SQL.
 */
export function detectMobileSyntaxLanguage(content: string, filePath = ''): string | null {
  const text = content.replace(/^\uFEFF/, '')
  const lineEnd = text.indexOf('\n')
  const firstLine = lineEnd === -1 ? text : text.slice(0, lineEnd)
  if (firstLine.startsWith('#!')) {
    return shebangLanguage(firstLine)
  }
  // The marks below sit at the top of a file; look no further than 4 KB.
  const head = text.length > 4_096 ? text.slice(0, 4_096) : text
  if (/\.m$/i.test(filePath)) {
    if (/^\s*(?:#import|#include|@interface|@implementation|@protocol)\b/m.test(head)) {
      return 'objectivec'
    }
    return /^\s*(?:function\b|%|end\s*$)/m.test(head) ? 'matlab' : null
  }
  const opening = head.trimStart()[0]
  if ((opening === '{' || opening === '[') && text.length <= MAX_JSON_DETECT_CHARS && parsesAsJson(text)) {
    return 'json'
  }
  if (/^\s*<(?:\?xml|!DOCTYPE|html|svg)\b/i.test(head)) {
    return 'xml'
  }
  return null
}

function parsesAsJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** The highlighter's language for a file, by its name, and by what its
 *  text declares when the name says nothing. */
export function resolveMobileSyntaxLanguageForContent(
  filePath: string,
  content: string,
  preferredLanguage?: string
): string {
  const byName = resolveMobileSyntaxLanguage(filePath, preferredLanguage)
  if (byName !== 'plaintext' || !isUnknownMobileFileName(filePath)) {
    return byName
  }
  return detectMobileSyntaxLanguage(content, filePath) ?? 'plaintext'
}

/** Whether `language` is one the highlighter colours. */
export function canHighlightMobileLanguage(language: string): boolean {
  const normalized = LANGUAGE_ALIASES[language] ?? language
  return normalized !== 'plaintext' && highlighter().registered(normalized)
}

export function highlightMobileCode(
  code: string,
  language: string,
  maxHighlightChars = MAX_FILE_HIGHLIGHT_CHARS,
  maxHighlightSegments = MAX_FILE_HIGHLIGHT_SEGMENTS
): { segments: MobileSyntaxSegment[]; highlighted: boolean } {
  if (code.length === 0) {
    return { segments: [{ text: '', kind: 'plain' }], highlighted: false }
  }

  const normalizedLanguage = LANGUAGE_ALIASES[language] ?? language
  if (!highlighter().registered(normalizedLanguage) || normalizedLanguage === 'plaintext') {
    return { segments: [{ text: code, kind: 'plain' }], highlighted: false }
  }

  const highlightLength = getHighlightBoundary(code, maxHighlightChars)
  const highlightedCode = code.slice(0, highlightLength)
  try {
    const tree = highlighter().highlight(normalizedLanguage, highlightedCode) as LowlightNode
    const segments = mergeAdjacentSegments(flattenLowlightNodes(tree.children ?? [], 'plain'))
    if (segments.length > maxHighlightSegments) {
      return { segments: [{ text: code, kind: 'plain' }], highlighted: false }
    }
    if (highlightLength < code.length) {
      appendSegment(segments, { text: code.slice(highlightLength), kind: 'plain' })
    }
    return { segments, highlighted: true }
  } catch {
    return { segments: [{ text: code, kind: 'plain' }], highlighted: false }
  }
}

export function highlightMobileDiffLines<TLine extends { text: string }>(
  lines: TLine[],
  language: string
): MobileHighlightedDiffLine<TLine>[] {
  let attemptedChars = 0
  let attemptedLines = 0
  let highlightedSegments = 0
  let exhaustedHighlightBudget = false

  return lines.map((line) => {
    const canHighlight =
      !exhaustedHighlightBudget &&
      attemptedLines < MAX_DIFF_HIGHLIGHT_LINES &&
      attemptedChars + line.text.length <= MAX_DIFF_HIGHLIGHT_CHARS &&
      highlightedSegments < MAX_DIFF_HIGHLIGHT_SEGMENTS
    if (!canHighlight) {
      return plainHighlightedLine(line)
    }

    attemptedLines += 1
    attemptedChars += line.text.length
    if (line.text.trim().length === 0) {
      return plainHighlightedLine(line)
    }
    const result = highlightMobileCode(
      line.text,
      language,
      Math.min(MAX_FILE_HIGHLIGHT_CHARS, 8_000),
      MAX_DIFF_LINE_HIGHLIGHT_SEGMENTS
    )
    if (
      !result.highlighted ||
      highlightedSegments + result.segments.length > MAX_DIFF_HIGHLIGHT_SEGMENTS
    ) {
      exhaustedHighlightBudget = true
      return plainHighlightedLine(line)
    }

    highlightedSegments += result.segments.length
    return { ...line, ...result }
  })
}

export function buildPlainMobileDiffSyntaxLines<TLine extends { text: string }>(
  lines: TLine[]
): MobileHighlightedDiffLine<TLine>[] {
  return lines.map((line) => plainHighlightedLine(line))
}

function getHighlightBoundary(code: string, maxHighlightChars: number): number {
  if (code.length <= maxHighlightChars) {
    return code.length
  }
  const boundary = code.lastIndexOf('\n', maxHighlightChars)
  return boundary > 0 ? boundary + 1 : maxHighlightChars
}

function flattenLowlightNodes(
  nodes: LowlightNode[],
  inheritedScope: MobileSyntaxScope
): MobileSyntaxSegment[] {
  const segments: MobileSyntaxSegment[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      for (const piece of kindsForText(node.value ?? '', inheritedScope)) {
        appendSegment(segments, piece)
      }
      continue
    }
    if (node.type !== 'element') {
      continue
    }
    const scope = scopeForClasses(node.properties?.className, inheritedScope) ?? inheritedScope
    for (const segment of flattenLowlightNodes(node.children ?? [], scope)) {
      appendSegment(segments, segment)
    }
  }
  return segments
}

function mergeAdjacentSegments(segments: MobileSyntaxSegment[]): MobileSyntaxSegment[] {
  const merged: MobileSyntaxSegment[] = []
  for (const segment of segments) {
    appendSegment(merged, segment)
  }
  return merged
}

function appendSegment(segments: MobileSyntaxSegment[], segment: MobileSyntaxSegment): void {
  if (!segment.text) {
    return
  }
  const previous = segments.at(-1)
  if (previous?.kind === segment.kind) {
    previous.text += segment.text
    return
  }
  segments.push({ ...segment })
}

function plainHighlightedLine<TLine extends { text: string }>(
  line: TLine
): MobileHighlightedDiffLine<TLine> {
  return {
    ...line,
    segments: [{ text: line.text, kind: 'plain' }],
    highlighted: false
  }
}
