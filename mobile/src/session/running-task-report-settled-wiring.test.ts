import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Which consumer of the transcript's settledness hears about the kept tail
// (`baseRetained`, use-mobile-native-chat-session.ts). The running-task
// report must: rows placed on a tail kept from an empty re-subscribe miss what
// the lead launched in the gap. The drafts must not: a send made then would
// never resolve its baseline, and its pending bubble would never retire once
// its row landed. d119bc17 folded it into the drafts' call instead of the
// report's (review, 2026-09-26). The two calls sit in one hook body with no
// value either returns, so reading the call's own arguments is the instrument.

const CONTROLLER = join(import.meta.dirname, 'use-mobile-native-chat-controller.ts')

/** The code of the controller, comments stripped, so prose that names a
 *  property cannot satisfy or fail the check. */
function code(): string {
  return readFileSync(CONTROLLER, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
}

/** The argument text of the first `callee({ … })` call, braces balanced. */
function callArguments(source: string, callee: string): string {
  const start = source.indexOf(`${callee}({`)
  expect(start, `${callee} call`).toBeGreaterThan(-1)
  let depth = 0
  for (let index = start + callee.length + 1; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(start, index + 1)
      }
    }
  }
  throw new Error(`unbalanced ${callee} call`)
}

function settledArgument(call: string): string {
  const match = /transcriptSettled:\s*([^,\n]+(?:\n\s*&&[^,\n]+)*)/.exec(call)
  expect(match, 'transcriptSettled argument').not.toBeNull()
  return match![1]!.trim()
}

describe("which consumer is told the transcript is a kept tail", () => {
  it('tells the running-task report, so it places no roster row on the kept tail', () => {
    expect(settledArgument(callArguments(code(), 'useActiveTabTaskReport'))).toContain('!nativeChatSession.baseRetained')
  })

  it('does not tell the drafts, whose sends must still resolve their baseline on it', () => {
    expect(settledArgument(callArguments(code(), 'useMobileNativeChatDrafts'))).not.toContain('baseRetained')
  })
})
