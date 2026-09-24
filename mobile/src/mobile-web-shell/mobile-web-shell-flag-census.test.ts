import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { censusSourceFiles } from '../test-support/census-source-files'

/**
 * The hybrid shell flag is the whole of what keeps this feature dark in a native build, so who
 * touches it is a product invariant rather than a convention. A second reader is how a dark feature
 * stops being dark: a launch-time sweep, a prefetch or a menu item that consults the flag would run
 * in a native store build the moment anything flipped it, and none of those would fail a type
 * check.
 *
 * The build-kind fact is the same shape of invariant one level up. `EXPO_PUBLIC_MOBILE_SHELL` is
 * what a release workflow sets to build the OTA binary, and a second module spelling it would be a
 * second answer to "is this the page's build" that no type check would catch either.
 */
const MOBILE_ROOT = join(import.meta.dirname, '..', '..')
const FLAG_KEY = 'orca:mobileWebShellEnabled'
/** The inlined form. Prose may name the variable; this is the spelling that reads it. */
const BUILD_SWITCH_READ = 'process.env.EXPO_PUBLIC_'
/** The other spelling Expo's plugin inlines, which is how the rule above would be evaded. */
const BUILD_SWITCH_BRACKET_READ = "process.env['EXPO_PUBLIC_"
const DEFINITION = 'src/storage/preferences.ts'
/** The one product reader. Every route asks it, so the list below stays the whole census. */
const FLAG_HOOK = 'src/mobile-web-shell/use-mobile-web-shell-enabled.ts'
const ROUTE = 'app/h/[hostId]/web.tsx'
const HOST_ROUTE = 'app/h/[hostId]/index.tsx'
const AGENT_HISTORY_ROUTE = 'app/h/[hostId]/agent-history/[worktreeId].tsx'
const TASKS_ROUTE = 'app/h/[hostId]/tasks.tsx'
const FILES_ROUTE = 'app/h/[hostId]/files/[worktreeId].tsx'
const FILES_PREVIEW_ROUTE = 'app/h/[hostId]/files/preview/[worktreeId].tsx'
const SOURCE_CONTROL_ROUTE = 'app/h/[hostId]/source-control/[worktreeId].tsx'
const REVIEW_ROUTE = 'app/h/[hostId]/review/[worktreeId].tsx'
/** The one switch with no native screen behind it; its route file only re-exports this body. */
const CATCH_ALL_ROUTE = 'src/mobile-web-shell/catch-all-page-route.tsx'
/** One entry per screen the flag can switch to the page, which is what a review reads. */
const SWITCHED_ROUTES = [
  HOST_ROUTE,
  AGENT_HISTORY_ROUTE,
  TASKS_ROUTE,
  FILES_ROUTE,
  FILES_PREVIEW_ROUTE,
  SOURCE_CONTROL_ROUTE,
  REVIEW_ROUTE,
  CATCH_ALL_ROUTE
]
const DEVELOPER_ROW = 'src/diagnostics/mobile-web-shell-dev-row.tsx'
/** The one screen that decides whether that row mounts, which is a build-kind question. Code UI
 *  keeps the whole Troubleshoot screen in the route file rather than upstream's TroubleshootView. */
const TROUBLESHOOT_ROUTE = 'app/troubleshoot.tsx'
/** Every tree that ships in the app bundle, with the floor each must clear. `modules` is two files,
 *  but it is where the native view lives and so the easiest place for a second reader to hide. */
const TREES = { src: 200, app: 10, modules: 1 }
const SHELL_VIEW = 'modules/orca-mobile-web-shell/src/index.ts'

function sourceFiles(directory: string): string[] {
  return censusSourceFiles(join(MOBILE_ROOT, directory))
    .map((path) => relative(MOBILE_ROOT, path))
    .filter((path) => /\.tsx?$/.test(path) && !path.includes('.test.'))
}

const SOURCES = Object.keys(TREES)
  .flatMap((tree) => sourceFiles(tree))
  .map((path) => ({
    path: path.split('\\').join('/'),
    text: readFileSync(join(MOBILE_ROOT, path), 'utf8')
  }))

function filesContaining(needle: string): string[] {
  return SOURCES.filter((file) => file.text.includes(needle))
    .map((file) => file.path)
    .sort()
}

describe('who touches the hybrid shell flag', () => {
  it('reaches every shipped tree, so the absence assertions below cannot pass vacuously', () => {
    const paths = SOURCES.map((file) => file.path)
    expect(paths).toContain(DEFINITION)
    expect(paths).toContain(FLAG_HOOK)
    expect(paths).toContain(ROUTE)
    for (const route of SWITCHED_ROUTES) {
      expect(paths).toContain(route)
    }
    expect(paths).toContain(DEVELOPER_ROW)
    expect(paths).toContain(TROUBLESHOOT_ROUTE)
    expect(paths).toContain(SHELL_VIEW)
    const trees = Object.keys(TREES)
    for (const [tree, floor] of Object.entries(TREES)) {
      expect(paths.filter((path) => path.startsWith(`${tree}/`)).length).toBeGreaterThan(floor)
    }
    expect(paths.filter((path) => !trees.some((tree) => path.startsWith(`${tree}/`)))).toEqual([])
  })

  it('keeps the storage key itself in one module', () => {
    expect(filesContaining(FLAG_KEY)).toEqual([DEFINITION])
  })

  it('reads the build-time switch in one module', () => {
    // `babel-preset-expo` inlines an `EXPO_PUBLIC_*` variable only where it is spelled as a
    // literal member expression of `process.env`, so a second read is a second literal to keep in
    // step with the workflow input — and a value copied out into a binding is not rewritten at
    // all, which reads `undefined` on a device and answers native in a build that is not.
    //
    // Prose is not a read: the docblocks that name the variable are how a reader finds this
    // module, and pinning them would make every wording change a census failure.
    expect(filesContaining(BUILD_SWITCH_READ)).toEqual([DEFINITION])
    expect(filesContaining(BUILD_SWITCH_BRACKET_READ)).toEqual([])
  })

  it('answers the build kind through one named function, asked by the flag and the row label', () => {
    expect(filesContaining('mobileShellBuildKind')).toEqual([DEFINITION, DEVELOPER_ROW].sort())
  })

  it('is read by one hook and by the developer row that writes it, and nowhere else', () => {
    expect(filesContaining('loadMobileWebShellEnabled')).toEqual(
      [DEFINITION, DEVELOPER_ROW, FLAG_HOOK].sort()
    )
  })

  it('reaches the switched routes through that hook and no others', () => {
    // Each switched route is a screen the flag decides the renderer of, and one more is one more
    // place a dark feature could turn itself on. The list grows once per domain series, in the PR
    // that switches the route file to MobileWebShellScreen, and never as a side effect of anything
    // else. A switched route is inert until MOBILE_WEB_PAGE_ROUTES lists it as well, so an entry
    // here can land a PR ahead of that one.
    expect(filesContaining('useMobileWebShellEnabled')).toEqual(
      [FLAG_HOOK, ROUTE, ...SWITCHED_ROUTES].sort()
    )
  })

  it('is written only by the developer row', () => {
    expect(filesContaining('saveMobileWebShellEnabled')).toEqual([DEFINITION, DEVELOPER_ROW].sort())
  })

  it('fences the build kind in one place, which the read and the Troubleshoot mount gate ask', () => {
    // The test that makes a native store build unable to turn the flag on: `__DEV__`, or a binary
    // built with the switch set to `ota`. `loadMobileWebShellEnabled` asks it, and so does the
    // Troubleshoot route to decide whether to mount the toggle at all, which is the one place a
    // user can switch an OTA build back to the native screens. Asking it rather than re-deriving
    // it is why the route and the flag can never disagree about the build.
    expect(filesContaining('mobileWebShellFlagCanBeOn')).toEqual(
      [DEFINITION, TROUBLESHOOT_ROUTE].sort()
    )
  })
})
