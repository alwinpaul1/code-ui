import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PACKAGE = join(__dirname, '../../packages/expo-background-link/android/src/main')
const manifest = readFileSync(join(PACKAGE, 'AndroidManifest.xml'), 'utf8')
const receiver = readFileSync(
  join(PACKAGE, 'java/expo/modules/backgroundlink/BackgroundLinkBootReceiver.kt'),
  'utf8'
)

/**
 * A source-reading test because the defect is STRUCTURAL: nothing existed that
 * could bring the link back, and "nothing exists" has no behavioural handle to
 * assert against. There is no Kotlin test harness in this repo, and a JS test
 * cannot observe a broadcast receiver the system talks to.
 *
 * The defect: the service returns START_STICKY and that was the whole recovery
 * story. Android does not honour START_STICKY after a force-stop — which is what
 * an aggressive OEM battery manager performs — and a reboot clears the process
 * outright. So the link stayed down until somebody opened the app, which is the
 * reported symptom: "notifications only work when the app is open".
 *
 * Asserted against code, not commentary: these files carry long "why" comments
 * that name every one of these strings in prose, so a bare `includes` would pass
 * on the explanation alone. Each check below is anchored to the syntax around it.
 */
/**
 * The copy gradle actually compiles is NOT packages/. pnpm installs a `file:`
 * dependency as a copy under node_modules/.pnpm, hardlinking the files that
 * exist at install time — so an edit to an existing file shows up in both, and
 * a NEW file shows up in neither until `pnpm install` runs again. That is
 * precisely how 0.7.2 nearly shipped a manifest declaring a receiver whose
 * class was not in the DEX: the manifest edit propagated, the new .kt did not,
 * and the app crashed on install with ClassNotFoundException the moment
 * MY_PACKAGE_REPLACED fired (2026-09-18). The APK-level check that caught it
 * was the phone.
 *
 * So the manifest and the SOURCE TREE GRADLE SEES must agree: every component
 * the manifest declares in this package must have a source file in the copy
 * that will be compiled. Reading packages/ alone cannot see this.
 */
describe('every native component the manifest declares is in the tree gradle compiles', () => {
  const compiled = join(__dirname, '../../node_modules/@codeui/expo-background-link/android/src/main')
  const compiledManifest = readFileSync(join(compiled, 'AndroidManifest.xml'), 'utf8')
  const declared = [...compiledManifest.matchAll(/android:name="expo\.modules\.backgroundlink\.(\w+)"/g)].map(
    (m) => m[1]!
  )

  it('declares at least the receiver and the service, so the check is not vacuous', () => {
    expect(declared).toEqual(expect.arrayContaining(['BackgroundLinkBootReceiver', 'BackgroundLinkService']))
  })

  it.each(declared.map((name) => [name]))('%s has a source file where gradle will look', (name) => {
    const source = join(compiled, 'java/expo/modules/backgroundlink', `${name}.kt`)
    expect(existsSync(source), `${name} is in the manifest but ${source} does not exist — run pnpm install`).toBe(true)
  })
})

describe('the background link comes back on its own', () => {
  it('declares the permission a boot broadcast requires', () => {
    expect(manifest).toMatch(
      /<uses-permission\s+android:name="android\.permission\.RECEIVE_BOOT_COMPLETED"\s*\/>/
    )
  })

  it('registers a receiver the system can reach', () => {
    // exported must be true: these broadcasts come from the system, and a
    // receiver it cannot see is a receiver that never fires.
    expect(manifest).toMatch(
      /<receiver[^>]*android:name="expo\.modules\.backgroundlink\.BackgroundLinkBootReceiver"[\s\S]*?android:exported="true"/
    )
  })

  // MY_PACKAGE_REPLACED matters as much as boot here: the in-app updater
  // installs in the background, so the likeliest moment for the link to die
  // unnoticed is straight after an update succeeds.
  it.each([
    ['android.intent.action.BOOT_COMPLETED'],
    ['android.intent.action.LOCKED_BOOT_COMPLETED'],
    ['android.intent.action.MY_PACKAGE_REPLACED']
  ])('acts on %s', (action) => {
    expect(manifest).toMatch(new RegExp(`<action\\s+android:name="${action.replace(/\./g, '\\.')}"`))
    expect(receiver).toContain(action.split('.').pop())
  })

  it('starts the service rather than merely observing the broadcast', () => {
    expect(receiver).toMatch(/startForegroundService\(service\)/)
    expect(receiver).toMatch(/action\s*=\s*BackgroundLinkService\.ACTION_START/)
  })

  /**
   * A receiver that throws takes the app down ON BOOT, which is a far worse
   * failure than the one being fixed. A background foreground-service start can
   * legitimately be refused — most often when the battery-optimisation exemption
   * was never granted — so the refusal has to be swallowed.
   */
  it('cannot crash the app on boot when the start is refused', () => {
    expect(receiver).toMatch(/catch\s*\(\s*_?\w*\s*:\s*Throwable\s*\)/)
  })

  /**
   * It is deliberately not gated on the user's preference: the native side
   * cannot read AsyncStorage, and it does not need to. The headless task calls
   * syncBackgroundLinkFromPreferences first and returns when delivery is off,
   * which lets the service stop itself. Pinned because it looks like a missing
   * check, and someone will otherwise "fix" it by adding one that cannot work.
   */
  it('relies on the task stopping itself when delivery is switched off', () => {
    const task = readFileSync(join(__dirname, 'background-link-task.ts'), 'utf8')
    expect(task).toMatch(/const on = await syncBackgroundLinkFromPreferences\(\)/)
    expect(task).toMatch(/if \(!on\) \{[\s\S]*?return/)
  })
})
