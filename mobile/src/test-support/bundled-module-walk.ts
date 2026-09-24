import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { posix, relative, sep } from 'node:path'
import { censusSourceFiles } from './census-source-files'

/** What an import may leave off, JavaScript included, since Metro bundles it as readily. */
const RESOLVED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
/** The platform files Metro prefers to the plain one, so an import can load either. */
const PLATFORM_SUFFIXES = ['', '.native', '.android', '.ios', '.web']
const GENERATED = /\.generated\.tsx?$/

/** Every file an import could name, in the order a resolver tries them. */
function importCandidates(from: string, specifier: string): string[] {
  const base = specifier.startsWith('.')
    ? posix.join(posix.dirname(from), specifier)
    : specifier.startsWith('@/')
      ? `src/${specifier.slice('@/'.length)}`
      : specifier
  const withExtensions = (stem: string) =>
    PLATFORM_SUFFIXES.flatMap((platform) =>
      RESOLVED_EXTENSIONS.map((extension) => `${stem}${platform}${extension}`)
    )
  return [base, ...withExtensions(base), ...withExtensions(`${base}/index`)]
}

/**
 * The module an import names, or null for a package or anything outside the walk.
 *
 * Resolved the way `tsconfig.json` resolves it: relative to the importer, `@/` from `src/`, and a
 * bare path from `mobile/` itself, which is what its `baseUrl` of `.` allows.
 */
export function resolveImport(
  from: string,
  specifier: string,
  known: ReadonlySet<string>
): string | null {
  return importCandidates(from, specifier).find((candidate) => known.has(candidate)) ?? null
}

/** Every module an import can load: a platform file and the plain one are both bundled. */
export function resolveImports(
  from: string,
  specifier: string,
  known: ReadonlySet<string>
): string[] {
  return importCandidates(from, specifier).filter((candidate) => known.has(candidate))
}

/**
 * Every module the app or the page is built from, relative to `mobile/`, the entry included.
 *
 * The roots are where the walk starts, not where it ends: any module an app module loads is
 * bundled too, wherever it sits, so the walk follows the imports into `scripts/`, into the repo's
 * vendored `src/shared/`, or into a platform file. A test's imports are not bundled and are not
 * followed. Of `*.generated.ts` files it skips only the build output `mobile/.gitignore` lists:
 * `censusSourceFiles` skips the whole suffix, which suits censuses that only fear vendored
 * bundles, but a hand-written one is app code. (Review of the v1.4.210 port, 2026-09-24: five store
 * writes hid in exactly these places.)
 */
export function bundledModules(options: {
  mobileDir: string
  roots: readonly string[]
  source: RegExp
  isTest: (file: string) => boolean
  importsOf: (file: string) => readonly string[]
}): string[] {
  const { mobileDir, roots, source, isTest, importsOf } = options
  const toFile = (path: string) => relative(mobileDir, path).split(sep).join('/')
  const buildOutput = new Set(
    readFileSync(`${mobileDir}.gitignore`, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => GENERATED.test(line))
  )
  const handWrittenGenerated = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const path = `${directory}/${name}`
      if (name === 'node_modules') {
        return []
      }
      if (statSync(path).isDirectory()) {
        return handWrittenGenerated(path)
      }
      return GENERATED.test(name) && !buildOutput.has(toFile(path)) ? [toFile(path)] : []
    })
  const onDisk = (from: string, specifier: string): string[] =>
    importCandidates(from, specifier).filter(
      (candidate) =>
        source.test(candidate) &&
        !candidate.includes('node_modules/') &&
        !buildOutput.has(candidate) &&
        existsSync(`${mobileDir}${candidate}`) &&
        statSync(`${mobileDir}${candidate}`).isFile()
    )
  const entry = (JSON.parse(readFileSync(`${mobileDir}package.json`, 'utf8')) as { main: string })
    .main
  const start = [
    ...roots.flatMap((root) => [
      ...censusSourceFiles(`${mobileDir}${root}`).map(toFile),
      ...handWrittenGenerated(`${mobileDir}${root}`)
    ]),
    entry
  ].filter((path) => source.test(path))
  const seen = new Set(start)
  const queue = [...start]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (isTest(file)) {
      continue
    }
    for (const specifier of importsOf(file)) {
      for (const target of onDisk(file, specifier)) {
        if (!seen.has(target)) {
          seen.add(target)
          queue.push(target)
        }
      }
    }
  }
  return [...seen].sort()
}
