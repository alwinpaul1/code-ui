import { readFileSync } from 'node:fs'
import { posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
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
 *   modules explain the rule in prose that names the very calls it counts. What is a comment is
 *   the TypeScript parser's answer, not a character scan's: a `//` or `/*` inside a string, a
 *   template, a regex or JSX text is code, and a regex such as `/\/*$/` once blanked every line
 *   after it.
 * - The owner's exports are an exact list, so a second way into the map cannot be exported.
 * - Every direct store write in a row's module must name a key constant the row lists as not
 *   mirrored, and that constant must be a literal outside the page allowlist. So a mirrored key
 *   written around the one path fails whether it is named by a constant or built into a local.
 * - Outside the rows, no module may spell a page key, and no module that imports a row, the
 *   allowlist, or a module that re-exports either with `export … from` may write the store
 *   directly. That rule is about the import, not the key's spelling, so an aliased, namespaced,
 *   rebound or batched key, or one taken from the allowlist's own lists, fails the same way.
 * - Nothing but test code wipes the whole store, since `clear()` takes every page key with it and
 *   the map would keep them all.
 *
 * What it cannot see: a key assembled at runtime from pieces none of these spell, a store reached
 * through something other than the package's default import, a helper in another module that
 * writes whatever key it is handed, or a key a module imports and then re-exports as its own
 * (`export { KEY }` or `export const K = KEY`) rather than with `export … from`.
 * `mirrored-storage-every-key.test.ts` is the behavioural check that each saver the page's keys
 * have, called for real, lands in the map under the key the shell reads for the page's route.
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
/** Fixtures only tests import, which may reset the store between cases. */
const TEST_SUPPORT = /^src\/test-support\/|\.test-support\.tsx?$/
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
 * The tokens whose text is the program's own. Outside them, a `//` or `/*` can only open a
 * comment; inside them it is a URL, a glob, a regex or a line of JSX text.
 */
const LITERAL_TOKENS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText
])

type Module = {
  /**
   * The source with every comment blanked to spaces and every newline kept, so a match's offset
   * still names its line. Strings are kept, because the keys this counts are string literals.
   */
  code: string
  /** Every module this one loads at runtime, as written: imports, `export … from`, `require`. */
  imports: readonly string[]
  /** The modules this one re-exports with `export … from`, which makes it a barrel for them. */
  reExports: readonly string[]
}

/**
 * A module read by the TypeScript parser, because only the parser knows where a regex ends.
 *
 * A character scan tracking quotes, which is what this used before, cannot tell `/\/*$/` from the
 * start of a block comment, and read everything after that regex as prose: one plant hid a bare
 * write of a page key on the line below it. It read the rest of a line after `/^https?:\/\//` as a
 * comment too, which cost 19 of this tree's non-test modules part of a line of code, and in nine
 * modules it lost its place the other way and read real comments as code.
 */
function parseModule(source: string, fileName: string): Module {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const literalEnds = new Map<number, number>()
  const imports: string[] = []
  const reExports: string[] = []
  const visit = (node: ts.Node): void => {
    if (LITERAL_TOKENS.has(node.kind)) {
      // JSX text has no trivia of its own, so it starts where it sits rather than past a space.
      literalEnds.set(ts.isJsxText(node) ? node.pos : node.getStart(file), node.end)
    }
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.isTypeOnly !== true &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text)
    }
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text)
      reExports.push(node.moduleSpecifier.text)
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      imports.push(node.moduleReference.expression.text)
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      imports.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  let code = ''
  let i = 0
  while (i < source.length) {
    const literalEnd = literalEnds.get(i)
    if (literalEnd !== undefined) {
      code += source.slice(i, literalEnd)
      i = literalEnd
      continue
    }
    if (source[i] === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) {
      const close = source[i + 1] === '/' ? source.indexOf('\n', i) : source.indexOf('*/', i + 2)
      const stop =
        close === -1 ? source.length : source[i + 1] === '/' ? close : close + '*/'.length
      code += source.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    code += source[i]
    i += 1
  }
  return { code, imports, reExports }
}

/** A snippet's code, read as the module kind its name says. */
function codeOnly(source: string, fileName = 'snippet.ts'): string {
  return parseModule(source, fileName).code
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
    ...code.matchAll(
      new RegExp(`\\bimport\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+['"]${escaped}['"]`, 'g')
    )
  ].map((match) => match[1])
  return [...new Set(['AsyncStorage', ...imported])]
}

type StoreWrite = Found & { method: string; firstArgument: string }

/** Every direct write to the store, however it wraps, with the first thing it passes. */
function storeWrites(code: string): StoreWrite[] {
  return storeNames(code).flatMap((name) =>
    [
      ...code.matchAll(new RegExp(`\\b${name}\\s*\\.\\s*(${STORE_WRITES})\\s*\\(\\s*([^,)]*)`, 'g'))
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
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
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

const moduleByFile = new Map<string, Module>()

function moduleOf(file: string): Module {
  const cached = moduleByFile.get(file)
  if (cached !== undefined) {
    return cached
  }
  const parsed = parseModule(read(file), file)
  moduleByFile.set(file, parsed)
  return parsed
}

function code(file: string): string {
  return moduleOf(file).code
}

/**
 * The module an import names, or null for a package or anything outside `mobile/`.
 *
 * Resolved the way `tsconfig.json` resolves it: relative to the importer, `@/` from `src/`, and a
 * bare path from `mobile/` itself, which is what its `baseUrl` of `.` allows.
 */
function resolveImport(from: string, specifier: string, known: ReadonlySet<string>): string | null {
  const base = specifier.startsWith('.')
    ? posix.join(posix.dirname(from), specifier)
    : specifier.startsWith('@/')
      ? `src/${specifier.slice('@/'.length)}`
      : specifier
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
  return candidates.find((candidate) => known.has(candidate)) ?? null
}

const ROW_FILES: readonly string[] = MIRRORED_WRITERS.map((row) => row.file)

/** Every non-test module that is not the owner, the allowlist or a row. */
function outsideModules(): string[] {
  return mobileSources().filter(
    (file) =>
      !TEST.test(file) &&
      file !== MIRROR_MODULE &&
      file !== ALLOWLIST_MODULE &&
      !ROW_FILES.includes(file)
  )
}

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

  it('reads the code after a regex that holds a comment opener, which is not a comment', () => {
    const source = [
      "export const trimSlashes = (url: string) => url.replace(/\\/*$/, '')",
      "export const reset = () => AsyncStorage.removeItem('orca:hostDockWidth')",
      "export const save = (url: string) => /^https?:\\/\\//.test(url) && AsyncStorage.setItem('k', url)"
    ].join('\n')
    expect(storeWrites(codeOnly(source)).map(({ at, method }) => ({ at, method }))).toEqual([
      { at: 2, method: 'removeItem' },
      { at: 3, method: 'setItem' }
    ])
  })

  it('reads a comment after a regex, or in an empty block, as prose', () => {
    const source = [
      '/a\\/\\/b/.test(s) // AsyncStorage.setItem(DOCK_WIDTH_KEY, v)',
      'try { run() } catch { // AsyncStorage.clear()',
      '}',
      'call(a, /* AsyncStorage.removeItem(K) */)'
    ].join('\n')
    const blanked = codeOnly(source)
    expect(blanked.split('\n')).toHaveLength(4)
    expect(storeWrites(blanked)).toEqual([])
  })

  it('reads JSX text as text, so a URL in it hides nothing after it', () => {
    const source = [
      'export const Link = () => <Text>see https://example.test</Text>; AsyncStorage.setItem(K, v)',
      'export const Note = () => <Text>{/* AsyncStorage.clear() */}</Text>'
    ].join('\n')
    expect(
      storeWrites(codeOnly(source, 'snippet.tsx')).map(({ at, method }) => ({ at, method }))
    ).toEqual([{ at: 1, method: 'setItem' }])
  })

  it('reads a whole-store wipe as a write with no key', () => {
    expect(
      storeWrites(codeOnly('await AsyncStorage.clear()')).map(({ method, firstArgument }) => ({
        method,
        firstArgument
      }))
    ).toEqual([{ method: 'clear', firstArgument: '' }])
  })

  it('reads every way a module can load another, and none a type import is', () => {
    const { imports, reExports } = parseModule(
      [
        "import type { A } from './types-only'",
        "import { b } from './named'",
        "import * as c from '@/namespaced'",
        "import './side-effect'",
        "export { d } from './barrel'",
        "export type { E } from './type-barrel'",
        "const f = require('./required')",
        "const g = import('./dynamic')"
      ].join('\n'),
      'src/storage/snippet.ts'
    )
    expect(imports).toEqual([
      './named',
      '@/namespaced',
      './side-effect',
      './barrel',
      './required',
      './dynamic'
    ])
    expect(reExports).toEqual(['./barrel'])
    const known = new Set([
      'src/storage/named.ts',
      'src/namespaced/index.tsx',
      'src/storage/barrel.ts'
    ])
    expect(
      imports.map((specifier) => resolveImport('src/storage/snippet.ts', specifier, known))
    ).toEqual([
      'src/storage/named.ts',
      'src/namespaced/index.tsx',
      null,
      'src/storage/barrel.ts',
      null,
      null
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
    const found = outsideModules().flatMap((file) => {
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

  it('lets no module that imports a page key write the store around the one path', () => {
    // Held by the import rather than by how the key is spelled, since a key can arrive renamed,
    // under a namespace, rebound to a local, inside an array or as the allowlist's own list, and a
    // spelling rule has to be taught each one after it has already got through.
    const known = new Set(mobileSources())
    const outside = outsideModules()
    const carriers = new Set([...ROW_FILES, ALLOWLIST_MODULE])
    const carries = (file: string, specifiers: readonly string[]): boolean =>
      specifiers.some((specifier) => carriers.has(resolveImport(file, specifier, known) ?? ''))
    // A module that re-exports a carrier is one too, however long the chain of them.
    let grew = true
    while (grew) {
      grew = false
      for (const file of outside) {
        if (!carriers.has(file) && carries(file, moduleOf(file).reExports)) {
          carriers.add(file)
          grew = true
        }
      }
    }
    const importers = outside.filter((file) => carries(file, moduleOf(file).imports))
    // Dozens today; none would mean the resolver lost them, and the clean result below with it.
    expect(importers.length).toBeGreaterThan(0)
    const found = importers.flatMap((file) =>
      storeWrites(code(file)).map(({ at, text }) => `${file}:${at} ${text}`)
    )
    expect(
      found,
      'a module that imports a page key writes the store itself, so the map would keep the old value'
    ).toEqual([])
  })

  it('lets nothing but test code wipe the whole store', () => {
    // `clear()` takes every page key with it and the map keeps them all, so the next page load is
    // handed everything the wipe was meant to remove.
    const wipes = mobileSources()
      .filter((file) => !TEST.test(file) && !TEST_SUPPORT.test(file) && file !== MIRROR_MODULE)
      .flatMap((file) =>
        storeWrites(code(file))
          .filter((write) => write.method === 'clear')
          .map(({ at, text }) => `${file}:${at} ${text}`)
      )
    expect(wipes).toEqual([])
  })
})
