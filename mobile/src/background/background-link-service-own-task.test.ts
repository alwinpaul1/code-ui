import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A source-reading test because the defect is STRUCTURAL: which task's finish
 * the service reacts to. There is no Kotlin test harness in this repo, and a JS
 * test cannot observe a HeadlessJsTaskContext listener.
 *
 * The defect (a Pixel on 0.9.54, 2026-09-27, "background service not running"
 * every hour overnight): HeadlessJsTaskContext.finishTask tells EVERY listener
 * about EVERY finished headless task. expo-task-manager runs one for each
 * WorkManager run of the hourly update check. BackgroundLinkService reset
 * `taskStarted` on any of them, so the next open started a second link task,
 * the two tasks ended each other, and the service stopped itself.
 *
 * Asserted against code, not commentary: the file explains all of this in
 * prose, so comments are stripped before anything is matched.
 *
 * Reads packages/, the source a change edits. The copy gradle compiles lives
 * under node_modules and lags packages/ until `pnpm install` runs; see
 * background-link-revival.test.ts.
 */
const SOURCE_DIR = join(
  __dirname,
  '../../packages/expo-background-link/android/src/main/java/expo/modules/backgroundlink'
)
const service = kotlinCode(readFileSync(join(SOURCE_DIR, 'BackgroundLinkService.kt'), 'utf8'))

describe("the background service outlives other modules' headless tasks", () => {
  const onFinish = functionBody(service, /override fun onHeadlessJsTaskFinish\(\s*taskId: Int\s*\)/)

  it("ignores another module's headless task finishing, before touching any of its own state", () => {
    // The guard must come first: anything above it runs for expo's task too.
    expect(onFinish).toMatch(/^\s*if \(taskId != ownTaskId\) \{?\s*return\b/)
  })

  it('never hands a finish to the base class, which stops the service on any id it does not hold', () => {
    // The base class's own task set is empty now that the service starts its
    // task itself, so its handler would call stopSelf() on expo's finish.
    expect(onFinish).not.toMatch(/super\.onHeadlessJsTaskFinish/)
  })

  it('still stops when its own task ends, so the wake lock is let go', () => {
    const afterGuard = onFinish.replace(/^\s*if \(taskId != ownTaskId\) \{?\s*return\s*\}?/, '')
    expect(afterGuard).toMatch(/\btaskStarted = false\b/)
    expect(afterGuard).toMatch(/\bstopSelf\(\)/)
    // Without the listener it never hears that its own task ended.
    expect(service).toMatch(/\.addTaskEventListener\(this\)/)
  })

  it('knows its own task by the id HeadlessJsTaskContext returned when it started it', () => {
    expect(service).toMatch(/\bownTaskId = \w+\.startTask\(/)
    // Starting through the base class as well would run a second link task.
    expect(service).not.toMatch(/super\.onStartCommand\(/)
  })

  it('forgets its task when it is destroyed, so the next start runs a fresh one', () => {
    const onDestroy = functionBody(service, /override fun onDestroy\(\)/)
    expect(onDestroy).toMatch(/\btaskStarted = false\b/)
    expect(onDestroy).toMatch(/\bownTaskId = null\b/)
  })
})

/**
 * Rule 9. The same night's log said "background service not running" eleven
 * times and never once why: nothing logged when the service stopped, and the
 * pause line read the state only on waking. So the service writes down when
 * and why it stopped, and the pause line reads it back.
 */
describe('the background service leaves behind when and why it stopped', () => {
  const module = kotlinCode(readFileSync(join(SOURCE_DIR, 'BackgroundLinkModule.kt'), 'utf8'))

  it('records a stop every time it is destroyed, whoever stopped it', () => {
    const onDestroy = functionBody(service, /override fun onDestroy\(\)/)
    // JS's request outranks the task ending: switching delivery off does both,
    // in either order, and "its task ended" would hide that the user did it.
    expect(onDestroy).toMatch(
      /recordStop\(\s*this,\s*requestedStopCause \?: stopCause \?: if \(taskRemoved\) STOP_TASK_REMOVED else STOP_EXTERNAL\s*\)/
    )
  })

  it('names its own task ending as the cause before it stops itself', () => {
    const onFinish = functionBody(service, /override fun onHeadlessJsTaskFinish\(\s*taskId: Int\s*\)/)
    expect(onFinish).toMatch(/stopCause = STOP_TASK_ENDED[\s\S]*stopSelf\(\)/)
  })

  it('names a stop JS asked for, and only while there is a service to stop', () => {
    const stop = functionBody(module, /private fun stopService\(\)/)
    expect(stop).toMatch(
      /if \(BackgroundLinkService\.isRunning\) \{?\s*BackgroundLinkService\.requestedStopCause = BackgroundLinkService\.STOP_JS[\s\S]*context\.stopService\(/
    )
  })

  it('names a foreground-service timeout, and stops as Android requires', () => {
    const onTimeout = functionBody(service, /override fun onTimeout\(\s*startId: Int,\s*fgsType: Int\s*\)/)
    expect(onTimeout).toMatch(/stopCause = STOP_TIMEOUT[\s\S]*stopSelf\(\)/)
  })

  it('remembers being swiped out of Recents, and keeps running', () => {
    const onTaskRemoved = functionBody(service, /override fun onTaskRemoved\(\s*rootIntent: Intent\?\s*\)/)
    expect(onTaskRemoved).toMatch(/\btaskRemoved = true\b/)
    expect(onTaskRemoved).toMatch(/recordTaskRemoved\(this\)/)
    expect(onTaskRemoved).not.toMatch(/stopSelf/)
  })

  it('starts each run with no cause left over from an earlier one', () => {
    const onStart = functionBody(service, /override fun onStartCommand\(/)
    const freshRun = onStart.slice(onStart.indexOf('taskStarted = true'))
    expect(freshRun).toMatch(/\bstopCause = null\b/)
    expect(freshRun).toMatch(/\brequestedStopCause = null\b/)
    expect(freshRun).toMatch(/\btaskRemoved = false\b/)
    expect(freshRun).toMatch(/recordStart\(this\)/)
  })

  it('reads the last process exit only on Android versions that have the API', () => {
    expect(service).toMatch(
      /if \(Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.R\) \{[^}]*getHistoricalProcessExitReasons\(/
    )
  })

  it('hands the record to JS', () => {
    expect(module).toMatch(/Function\("lastStop"\) \{\s*BackgroundLinkService\.lastStop\(requireContext\(\)\)/)
  })
})

/** Kotlin source with every comment removed and string literals left in place. */
function kotlinCode(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const two = source.slice(i, i + 2)
    if (two === '//') {
      while (i < source.length && source[i] !== '\n') {
        i += 1
      }
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
    } else if (source[i] === '"') {
      const end = stringEnd(source, i)
      out += source.slice(i, end)
      i = end
    } else {
      out += source[i]
      i += 1
    }
  }
  return out
}

/** The text between the braces of the first function whose header matches. */
function functionBody(code: string, header: RegExp): string {
  const match = header.exec(code)
  if (!match) {
    throw new Error(`no function matching ${header} in the service`)
  }
  const open = code.indexOf('{', match.index + match[0].length)
  let depth = 0
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '"') {
      i = stringEnd(code, i) - 1
    } else if (code[i] === '{') {
      depth += 1
    } else if (code[i] === '}') {
      depth -= 1
      if (depth === 0) {
        return code.slice(open + 1, i)
      }
    }
  }
  throw new Error(`unbalanced braces after ${header}`)
}

function stringEnd(source: string, start: number): number {
  let i = start + 1
  while (i < source.length && source[i] !== '"') {
    i += source[i] === '\\' ? 2 : 1
  }
  return i + 1
}
