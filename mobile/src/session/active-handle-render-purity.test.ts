import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SESSION_DIR = join(import.meta.dirname)

function sourceFiles(): string[] {
  return readdirSync(SESSION_DIR)
    .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
    .map((name) => join(SESSION_DIR, name))
}

/** Lines that read `activeHandleRef.current` outside a callback or effect body —
 *  i.e. during render. A ref is mutated outside React, so a render that reads
 *  one is impure: React does not track the value, and `useSyncExternalStore`
 *  ends up holding a snapshot closed over whichever handle the previous render
 *  happened to see. The chat path did this in four places (0.3.6). */
function renderTimeRefReads(source: string): string[] {
  const hits: string[] = []
  let depth = 0
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    // A top-level `const x = ...` inside a hook body is render time; anything
    // nested inside a further brace pair is a callback, effect or handler.
    if (depth <= 1 && line.includes('activeHandleRef.current') && !line.includes('=')) {
      hits.push(line)
    } else if (
      depth <= 1 &&
      /^(const|let|return)\b/.test(line) &&
      line.includes('activeHandleRef.current') &&
      !line.includes('=>')
    ) {
      hits.push(line)
    }
    for (const char of rawLine) {
      if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
      }
    }
  }
  return hits
}

describe('the active PTY handle', () => {
  it('is never read from its ref while rendering', () => {
    const offenders = sourceFiles().flatMap((file) => {
      const hits = renderTimeRefReads(readFileSync(file, 'utf8'))
      return hits.map((line) => `${file.split('/').pop()}: ${line}`)
    })

    expect(offenders).toEqual([])
  })

  it('is published to state everywhere the ref is written', () => {
    // What made the render-time reads look correct: every writer happened to
    // call setActiveHandle in the same batch, so the ref was fresh by the time
    // React re-rendered. Nothing enforced that. One write without the setState
    // and the HUD, the Chat/Terminal button and the transcript stream key all
    // silently follow a handle the UI is not showing.
    const unpaired: string[] = []
    for (const file of sourceFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        // An assignment, not a comparison: `=` not followed by `=`.
        if (!/activeHandleRef\.current\s*=[^=]/.test(line)) {
          return
        }
        // The route resets a batch of refs at the top of an effect and calls
        // setActiveHandle once at the end of it, so the pairing can be wide.
        const window = lines.slice(index + 1, index + 40).join('\n')
        if (!window.includes('setActiveHandle(')) {
          unpaired.push(`${file.split('/').pop()}:${index + 1} ${line.trim()}`)
        }
      })
    }

    expect(unpaired).toEqual([])
  })
})
