import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// TalkBack stopped offering a reply's links once Android drew prose as one
// native TextView (modules/orca-native-prose, 2026-10-09): the link words were
// a plain CharacterStyle, so the accessibility node carried no link at all and
// a screen-reader user could not open one. TalkBack lists and activates a
// TextView's links only from ClickableSpans in its text (Android O and later
// copy each one into the node as an AccessibilityClickableSpan, and TalkBack's
// Links menu calls its onClick). The view is native, with no Kotlin test
// harness in this repo, so the structure is pinned from the source.

const DIR = path.join(
  __dirname,
  '../../modules/orca-native-prose/android/src/main/java/expo/modules/orcanativeprose'
)

/** The file's code with its comments taken out, so a match is never prose. */
function code(file: string): string {
  return readFileSync(path.join(DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('TalkBack can find and open the links in a native prose reply', () => {
  it('marks each link as a ClickableSpan, the only kind TalkBack lists', () => {
    expect(code('NativeProseSpans.kt')).toMatch(
      /class ProseLinkSpan\([^)]*\)\s*:\s*ClickableSpan\(\)/
    )
  })

  it('opens the link through the same press the tap sends', () => {
    const spans = code('NativeProseSpans.kt')
    const onClick = /override fun onClick\(widget: View\)\s*\{([^}]*)\}/.exec(spans)?.[1] ?? ''
    expect(onClick).toMatch(/\(widget as\? NativeProseTextView\)\?\.pressLink\(link\)/)
    const view = code('NativeProseTextView.kt')
    expect(view).toMatch(/fun pressLink\(link: Int\)\s*\{\s*onLinkPress\(mapOf\("link" to link\)\)/)
    // The tap goes through it too, so the two can never send different events.
    expect(view.match(/onLinkPress\(/g)).toHaveLength(1)
  })

  it('keeps the link colour and underline the span drew before', () => {
    const spans = code('NativeProseSpans.kt')
    const draw = /class ProseLinkSpan[\s\S]*?override fun updateDrawState\(paint: TextPaint\)\s*\{([^}]*)\}/.exec(
      spans
    )?.[1]
    expect(draw).toMatch(/paint\.color = color/)
    expect(draw).toMatch(/paint\.isUnderlineText = true/)
  })
})
