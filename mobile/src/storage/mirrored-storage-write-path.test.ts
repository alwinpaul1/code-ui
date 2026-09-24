import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  PAGE_STORAGE_EXACT_KEYS,
  PAGE_STORAGE_KEY_PREFIXES
} from '../mobile-web-shell/page-storage-keys'
import { censusSourceFiles } from '../test-support/census-source-files'

/**
 * One owner for the mirror the hybrid shell reads (ruling 35).
 *
 * `mirrored-storage-keys.ts` holds the map the shell builds every `init` from, synchronously, and
 * before this the fourteen writers of a mirrored key noted it themselves — first, then persisted.
 * On the page a persist can be refused, so twelve of them left the map holding a value no store
 * had taken and the next `init` handed the page exactly that; the other two undid it by hand.
 *
 * Source-scanning rather than behavioural, and about existence rather than shape: what a
 * behavioural case cannot say is that no new writer appears next week. Each row below is a module
 * that owns a mirrored key, so deleting its write path reds that row by name, and every failure
 * quotes the line it found.
 *
 * Upstream Orca carries this census as `config/scripts/mobile-mirrored-storage-write-path.test.mjs`
 * (#21977). This fork has no `config/scripts`, and the census reads nothing but `mobile/`, so it
 * lives here and runs in the mobile gate. What this fork adds:
 *
 * - Comments are blanked before anything is matched, and a call may wrap across lines. These
 *   modules explain the rule in prose that names the very calls it counts.
 * - The owner's exports are an exact list, so a second way into the map cannot be exported.
 * - Every direct store write in a row's module must name a key constant the row lists as not
 *   mirrored, and that constant must be a literal outside the page allowlist. So a mirrored key
 *   written around the one path fails whether it is named by a constant or built into a local.
 * - Outside the rows, no module may spell a page key or write the store with a key constant a row
 *   exports, so a new module cannot write a mirrored key past the map by either route.
 *
 * What it cannot see: a key assembled at runtime from pieces none of these spell, a store reached
 * through something other than the package's default import, or a helper in another module that
 * writes whatever key it is handed. `mirrored-storage-every-key.test.ts` is the behavioural check
 * that each saver the page's keys have, called for real, lands in the map.
 */

const MOBILE_DIR = fileURLToPath(new URL('../../', import.meta.url))

const MIRROR_MODULE = 'src/storage/mirrored-storage-keys.ts'
const ALLOWLIST_MODULE = 'src/mobile-web-shell/page-storage-keys.ts'

/** What the owner exports, and all it exports: the map and `note` stay inside it. */
const OWNER_EXPORTS = [
  'hydrateMirroredStorage',
  'persistMirrored',
  'readMirroredStorage',
  'writeMirroredStorage'
]

/**
 * Every module that persists a key the shell mirrors, with the keys it may still write straight to
 * the store. Those are the module's other preferences, which the page is never handed.
 */
const MIRRORED_WRITERS = [
  {
    file: 'src/storage/preferences.ts',
    unmirrored: [
      'NOTIF_KEY',
      'REMOTE_PUSH_KEY',
      'POWER_ASKED_AT_KEY',
      'POWER_LAST_SEEN_KEY',
      'POWER_REQUESTED_AT_KEY',
      'MOBILE_WEB_SHELL_KEY',
      'LIVE_TRANSCRIPTION_KEY'
    ]
  },
  { file: 'src/storage/session-view-preferences.ts', unmirrored: ['CHAT_FOCUS_VIEW_KEY'] },
  { file: 'src/terminal/terminal-accessory-layout.ts', unmirrored: [] },
  { file: 'src/components/CustomKeyModal.tsx', unmirrored: [] },
  { file: 'src/session/mobile-structured-send-operation-journal.ts', unmirrored: [] },
  { file: 'src/worktree/last-visited-worktree-repo.ts', unmirrored: [] }
] as const

/**
 * The one caller of the note-then-persist path, which is the shell taking a value the page has
 * already applied into a store that refuses nothing.
 *
 * Counted rather than described: the module says the census holds it to one caller, and until
 * this row nothing did. A second caller is either a writer that wants the ordering without the
 * store that earns it, or a page-reachable module that would note a refusal as an accepted write.
 */
const NOTE_FIRST_CALLER = 'src/mobile-web-shell/use-page-host-snapshot.ts'

const SOURCE_ROOTS = ['src', 'app', 'web-entry']
const SOURCE = /\.tsx?$/
const TEST = /\.(test|spec)\.tsx?$/
const STORE_PACKAGE = '@react-native-async-storage/async-storage'
const STORE_WRITES = 'setItem|removeItem|mergeItem|multiSet|multiRemove|multiMerge|clear'

/** Every module the app or the page is built from, so a new caller cannot hide in a folder. */
function mobileSources(): string[] {
  return SOURCE_ROOTS.flatMap((root) => censusSourceFiles(`${MOBILE_DIR}${root}`))
    .filter((path) => SOURCE.test(path))
    .map((path) => relative(MOBILE_DIR, path).split(sep).join('/'))
    .sort()
}

/**
 * The source with every comment blanked to spaces and every newline kept, so a match's offset
 * still names its line. Strings are kept, because the keys this counts are string literals, and a
 * `//` inside one is not a comment.
 */
function codeOnly(source: string): string {
  let out = ''
  let quote: string | null = null
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (quote !== null) {
      out += ch
      if (ch === '\\' && next !== undefined) {
        out += next
        i += 2
        continue
      }
      // A quote that never closes ends at the line, so a regex literal holding one costs a line.
      if (ch === quote || (ch === '\n' && quote !== '`')) {
        quote = null
      }
      i += 1
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' '
        i += 1
      }
      continue
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      out += source.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
    }
    out += ch
    i += 1
  }
  return out
}

type Found = { at: number; text: string }

/** Each match in code, with its line and its own text, so a failure names what it found. */
function matchesIn(code: string, pattern: RegExp): Found[] {
  return [...code.matchAll(pattern)].map((match) => ({
    at: code.slice(0, match.index).split('\n').length,
    text: match[0].replace(/\s+/g, ' ').trim()
  }))
}

/** The names a module binds the store package to, which is `AsyncStorage` everywhere today. */
function storeNames(code: string): string[] {
  const escaped = STORE_PACKAGE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const imported = [
    ...code.matchAll(new RegExp(`\\bimport\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+['"]${escaped}['"]`, 'g'))
  ].map((match) => match[1])
  return [...new Set(['AsyncStorage', ...imported])]
}

type StoreWrite = Found & { method: string; firstArgument: string }

/** Every direct write to the store, however it wraps, with the first thing it passes. */
function storeWrites(code: string): StoreWrite[] {
  return storeNames(code).flatMap((name) =>
    [
      ...code.matchAll(
        new RegExp(`\\b${name}\\s*\\.\\s*(${STORE_WRITES})\\s*\\(\\s*([^,)]*)`, 'g')
      )
    ].map((match) => ({
      at: code.slice(0, match.index).split('\n').length,
      text: match[0].replace(/\s+/g, ' ').trim(),
      method: match[1],
      firstArgument: match[2].trim()
    }))
  )
}

/** Whether a key, or the start of one, is something the page is handed. */
function isPageKey(literal: string): boolean {
  return (
    (PAGE_STORAGE_EXACT_KEYS as readonly string[]).includes(literal) ||
    PAGE_STORAGE_KEY_PREFIXES.some((prefix) => literal.startsWith(prefix))
  )
}

/** Every string literal's opening run, up to its quote or its first template hole. */
function literals(code: string): Found[] {
  return [...code.matchAll(/(['"`])((?:\\.|(?!\1)(?!\$\{)[^\\\n])*)/g)].map((match) => ({
    at: code.slice(0, match.index).split('\n').length,
    text: match[2]
  }))
}

/** What a module exports by name, `default` and `*` included, sorted. */
function exportedNames(code: string): string[] {
  const names: string[] = []
  const declared =
    /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|enum|interface|type|namespace)\s*([A-Za-z_$][\w$]*)/g
  for (const match of code.matchAll(declared)) {
    names.push(match[1])
  }
  names.push(...[...code.matchAll(/\bexport\s+default\b/g)].map(() => 'default'))
  for (const match of code.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name) {
        names.push(name)
      }
    }
  }
  names.push(...[...code.matchAll(/\bexport\s*\*/g)].map(() => '*'))
  return names.sort()
}

function read(file: string): string {
  return readFileSync(`${MOBILE_DIR}${file}`, 'utf8')
}

const codeByFile = new Map<string, string>()

function code(file: string): string {
  const cached = codeByFile.get(file)
  if (cached !== undefined) {
    return cached
  }
  const blanked = codeOnly(read(file))
  codeByFile.set(file, blanked)
  return blanked
}

const ROW_FILES: readonly string[] = MIRRORED_WRITERS.map((row) => row.file)

describe('the census reader', () => {
  it('reads a call a comment names as prose, and a call behind a block comment as code', () => {
    const source = [
      "const url = 'https://example.test' // AsyncStorage.setItem(DOCK_WIDTH_KEY, v)",
      '/* note */ AsyncStorage.setItem(',
      '  DOCK_WIDTH_KEY,',
      '  value',
      ')'
    ].join('\n')
    const blanked = codeOnly(source)
    expect(blanked.split('\n')).toHaveLength(5)
    expect(blanked).toContain("'https://example.test'")
    expect(storeWrites(blanked).map(({ at, firstArgument }) => ({ at, firstArgument }))).toEqual([
      { at: 2, firstArgument: 'DOCK_WIDTH_KEY' }
    ])
  })

  it('reads a key out of a template literal up to its first hole', () => {
    const blanked = codeOnly('const key = `orca:pins:${hostId}`')
    expect(literals(blanked).filter((literal) => isPageKey(literal.text))).toEqual([
      { at: 1, text: 'orca:pins:' }
    ])
  })

  it('reads every key off the allowlist itself, so a clean scan elsewhere means something', () => {
    const spelled = literals(code(ALLOWLIST_MODULE))
      .map((literal) => literal.text)
      .filter(isPageKey)
    expect([...new Set(spelled)].sort()).toEqual(
      [...PAGE_STORAGE_EXACT_KEYS, ...PAGE_STORAGE_KEY_PREFIXES].sort()
    )
  })

  it('finds nothing in an empty module', () => {
    expect(storeWrites(codeOnly(''))).toEqual([])
    expect(exportedNames(codeOnly(''))).toEqual([])
  })
})

describe('the mirrored storage write path', () => {
  it('is the only thing that writes the map, which no other module can reach', () => {
    // The map and `note` are the owner's alone: a module holding either is a second owner, and an
    // export list is what can say so, whichever way the export is spelled.
    expect(exportedNames(code(MIRROR_MODULE))).toEqual(OWNER_EXPORTS)
  })

  it(`names the note-first path from ${NOTE_FIRST_CALLER} and nowhere else`, () => {
    const callers = mobileSources().filter(
      (file) =>
        file !== MIRROR_MODULE &&
        file !== 'src/storage/mirrored-storage-write-path.test.ts' &&
        matchesIn(code(file), /\bwriteMirroredStorage\b/g).length > 0
    )
    expect(callers).toEqual([NOTE_FIRST_CALLER])
  })

  it('has a row for every module that writes through the one path', () => {
    const writers = mobileSources().filter(
      (file) =>
        file !== MIRROR_MODULE &&
        !TEST.test(file) &&
        matchesIn(code(file), /\bpersistMirrored\s*\(/g).length > 0
    )
    expect(writers).toEqual([...ROW_FILES].sort())
  })

  for (const row of MIRRORED_WRITERS) {
    it(`writes ${row.file} through the one path and never around it`, () => {
      const source = code(row.file)
      expect(matchesIn(source, /\bpersistMirrored\s*\(/g).length).toBeGreaterThan(0)
      // Around it is a store call on a key the map holds, which is the shape every one of these
      // had before. Named here by what it may write, so a local `key` or a batch call fails too.
      const allowed: readonly string[] = row.unmirrored
      expect(
        storeWrites(source).filter((write) => !allowed.includes(write.firstArgument)),
        `${row.file} writes the store past the mirror`
      ).toEqual([])
      for (const name of row.unmirrored) {
        const declared = new RegExp(`\\bconst\\s+${name}\\s*=\\s*(['"\`])([^'"\`]*)\\1`).exec(
          source
        )
        expect(declared?.[2], `${row.file} declares ${name} as a literal`).toBeDefined()
        expect(isPageKey(declared?.[2] ?? ''), `${name} is a key the page is handed`).toBe(false)
      }
    })
  }

  it('lets no other module spell a key the page is handed, or write one a row exports', () => {
    const exportedKeys = ROW_FILES.flatMap((file) =>
      [...code(file).matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`]*)\2/g)]
        .filter((match) => isPageKey(match[3]))
        .map((match) => match[1])
    )
    // Two today; zero would mean the scan above lost them, not that none are exported.
    expect(exportedKeys.length).toBeGreaterThan(0)
    const outside = mobileSources().filter(
      (file) =>
        !TEST.test(file) &&
        file !== MIRROR_MODULE &&
        file !== ALLOWLIST_MODULE &&
        !ROW_FILES.includes(file)
    )
    const found = outside.flatMap((file) => {
      const source = code(file)
      const spelled = literals(source)
        .filter((literal) => isPageKey(literal.text))
        .map(({ at, text }) => `${file}:${at} spells '${text}'`)
      const written = storeWrites(source)
        .filter((write) => exportedKeys.includes(write.firstArgument))
        .map(({ at, text }) => `${file}:${at} ${text}`)
      return [...spelled, ...written]
    })
    expect(found).toEqual([])
  })
})
