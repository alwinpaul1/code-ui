import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Until 2026-10-08 the chat turned `selectable` off while the reader's fling
// was in flight, and a second block here pinned that the flip kept each Text
// the same native view (React Native 0.86.3: NativeSelectableText is its own
// host only under enablePreparedTextLayout, off in every OSS Android build).
// Orca #22871 took inline selection off the Android chat transcript
// altogether, so nothing flips `selectable` any more and that block guarded
// nothing; it was removed with the gate.
//
// What stays: a hold on a link must not open it on release. Off the
// transcript that is markdown-link-hold.ts's no-op onLongPress; on the
// Android transcript the hold opens the message's actions sheet, and the same
// Pressability rule is what keeps the release from also opening the link.

const require = createRequire(import.meta.url)
const reactNative = path.dirname(require.resolve('react-native/package.json'))

/** The file's code with its comments taken out, so a match is never prose. */
function code(relative: string): string {
  return readFileSync(path.join(reactNative, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

// A link in selectable text opens on a tap and must not on a hold
// (markdown-link-hold.ts). That rests on Pressability: after a long press the
// release still fires onPress unless onLongPress is set, and Text hands its
// onLongPress to Pressability but no delayLongPress, so the default 500 ms
// is what makes a press long. If any of this changes, the guard does too.
describe('a hold on a link in chat text does not open it', () => {
  it('lets a long press cancel the release’s press only when onLongPress is set', () => {
    expect(code('Libraries/Pressability/Pressability.js')).toMatch(
      /const isPressCanceledByLongPress =\s*onLongPress != null && prevState === 'RESPONDER_ACTIVE_LONG_PRESS_IN';\s*if \(!isPressCanceledByLongPress\) \{/
    )
    expect(code('Libraries/Pressability/Pressability.js')).toMatch(/const DEFAULT_LONG_PRESS_DELAY_MS = 500;/)
  })

  it('hands a Text’s onLongPress to its press handling, with no delayLongPress', () => {
    const text = code('Libraries/Text/Text.js')
    const pressProps = /textPressabilityProps = \{([^}]*)\}/.exec(text)?.[1] ?? ''
    expect(pressProps).toMatch(/\bonLongPress,/)
    expect(pressProps).toMatch(/\bonPress,/)
    expect(pressProps).not.toMatch(/delayLongPress/)
  })
})
