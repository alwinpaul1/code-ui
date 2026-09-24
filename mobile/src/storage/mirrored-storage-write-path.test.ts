import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
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
 * behavioural case cannot say is that no thirteenth writer appears next week. Each row below is a
 * module that owns a mirrored key, so deleting its write path reds that row by name, and every
 * failure quotes the line it found.
 *
 * Upstream Orca carries this census as `config/scripts/mobile-mirrored-storage-write-path.test.mjs`
 * (#21977). This fork has no `config/scripts`, and the census reads nothing but `mobile/`, so it
 * lives here and runs in the mobile gate. Two things are this fork's: comment lines are skipped,
 * because these modules explain the rule in prose that names the very calls it counts; and the
 * rows are held to every `persistMirrored` caller in the tree, so a new writer cannot pass
 * without a row that checks it.
 */

const MOBILE_DIR = fileURLToPath(new URL('../../', import.meta.url))

const MIRROR_MODULE = 'src/storage/mirrored-storage-keys.ts'

/** Every module that persists a key the shell mirrors, with the constant each one writes. */
const MIRRORED_WRITERS = [
  {
    file: 'src/storage/preferences.ts',
    keys: ['TEXT_SCALE_KEY', 'SIDEBAR_WIDTH_KEY', 'DOCK_WIDTH_KEY']
  },
  { file: 'src/storage/session-view-preferences.ts', keys: ['DEFAULT_SESSION_VIEW_KEY'] },
  {
    file: 'src/terminal/terminal-accessory-layout.ts',
    keys: ['TERMINAL_ACCESSORY_LAYOUT_STORAGE_KEY']
  },
  { file: 'src/components/CustomKeyModal.tsx', keys: ['CUSTOM_ACCESSORY_KEYS_STORAGE_KEY'] },
  { file: 'src/session/mobile-structured-send-operation-journal.ts', keys: ['STORAGE_KEY'] },
  {
    file: 'src/worktree/last-visited-worktree-repo.ts',
    keys: ['LAST_VISITED_WORKTREE_STORAGE_KEY']
  }
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

const SOURCE = /\.tsx?$/
const TEST = /\.(test|spec)\.tsx?$/
/** A line that is only commentary: a docblock row, a line comment, or a block comment's start. */
const COMMENT_LINE = /^(\/\/|\/\*|\*)/

/** Every module under `mobile/src`, so a new caller cannot arrive in a file no row names. */
function mobileSources(): string[] {
  return censusSourceFiles(`${MOBILE_DIR}src`)
    .filter((path) => SOURCE.test(path))
    .map((path) => relative(MOBILE_DIR, path).split(sep).join('/'))
    .sort()
}

/** The line a match sits on, so a failure names what it found rather than only that it found one. */
function linesMatching(source: string, pattern: RegExp): { line: string; at: number }[] {
  return source
    .split('\n')
    .map((line, index) => ({ line: line.trim(), at: index + 1 }))
    .filter((entry) => !COMMENT_LINE.test(entry.line) && pattern.test(entry.line))
}

function read(file: string): string {
  return readFileSync(`${MOBILE_DIR}${file}`, 'utf8')
}

describe('the mirrored storage write path', () => {
  it('is the only thing that writes the map, which no other module can reach', () => {
    const owner = read(MIRROR_MODULE)
    // The map itself: a second module holding a reference to it would be a second owner, and the
    // map is not exported, so this is what says so.
    expect(linesMatching(owner, /^export (const|let) mirror\b/)).toEqual([])
    expect(linesMatching(owner, /^export function note\b/)).toEqual([])
  })

  it(`calls the note-first path from ${NOTE_FIRST_CALLER} and nowhere else`, () => {
    const callers = mobileSources().filter((file) => {
      if (file === MIRROR_MODULE) {
        return false
      }
      return linesMatching(read(file), /\bwriteMirroredStorage\(/).length > 0
    })
    expect(callers).toEqual([NOTE_FIRST_CALLER])
  })

  it('has a row for every module that writes through the one path', () => {
    const writers = mobileSources().filter(
      (file) =>
        file !== MIRROR_MODULE &&
        !TEST.test(file) &&
        linesMatching(read(file), /\bpersistMirrored\(/).length > 0
    )
    expect(writers).toEqual(MIRRORED_WRITERS.map((row) => row.file).sort())
  })

  for (const row of MIRRORED_WRITERS) {
    it(`writes ${row.file} through the one path and never around it`, () => {
      const source = read(row.file)
      expect(linesMatching(source, /\bpersistMirrored\(/).length).toBeGreaterThan(0)
      // Around it would be a store call naming a key the map holds, which is the shape every one
      // of these had before: note the map, then persist, and nothing between the two agreeing.
      for (const key of row.keys) {
        expect(
          linesMatching(source, new RegExp(`AsyncStorage\\.(setItem|removeItem)\\(\\s*${key}\\b`)),
          `${row.file} writes ${key} past the mirror`
        ).toEqual([])
      }
      expect(
        linesMatching(source, /\bnoteMirroredWrite\b/),
        `${row.file} notes the map itself`
      ).toEqual([])
    })
  }
})
