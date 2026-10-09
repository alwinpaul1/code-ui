import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The chat turns `selectable` off while the reader's fling is in flight and
// back on after (chat-text-selectable-context.ts). On 2026-09-25 a hold on
// the agent's reply mid-turn selected nothing, and one suspect was that
// flip: if `selectable` changed which native view a Text is, every flip
// would unmount and remount every chat Text, and a hold would land on a
// view about to be replaced.
//
// On React Native 0.86.3 it does not, and this pins why: a selectable Text
// is `NativeSelectableText`, which is a separate host (RCTSelectableText,
// a real TextView, because PreparedLayoutTextView cannot select) ONLY when
// `enablePreparedTextLayout` is on, and that flag is off in every place an
// OSS Android build takes it from. So the flip only calls
// setTextIsSelectable on the same TextView. If an upgrade turns the flag on,
// this fails, and the scroll gate has to stop flipping the prop.
//
// What this cannot show: Android's own rule that a hold which began while a
// TextView was not selectable never becomes a selection, even if it turns
// selectable under the finger. That is why the gate must not be off at
// touch-down (use-mobile-native-chat-tail-follow.selection.test.ts).

const require = createRequire(import.meta.url)
const reactNative = path.dirname(require.resolve('react-native/package.json'))
const featureFlags = 'ReactAndroid/src/main/java/com/facebook/react/internal/featureflags'

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

describe('flipping selection for a scroll keeps each chat Text the same native view', () => {
  it('draws a selectable Text as NativeSelectableText and any other as NativeText', () => {
    expect(code('Libraries/Text/Text.js')).toMatch(
      /_selectable === true \?\s*\(\s*<NativeSelectableText[^>]*\/>\s*\)\s*:\s*\(\s*<NativeText /
    )
  })

  it('makes NativeSelectableText its own host only under enablePreparedTextLayout', () => {
    expect(code('Libraries/Text/TextNativeComponent.js')).toMatch(
      /export const NativeSelectableText[^=]*=\s*enablePreparedTextLayout\(\)\s*\?[\s\S]*?:\s*NativeText;/
    )
  })

  it('leaves enablePreparedTextLayout off in JS, in C++ and in every OSS Android override', () => {
    expect(code('src/private/featureflags/ReactNativeFeatureFlags.js')).toMatch(
      /enablePreparedTextLayout: Getter<boolean> = createNativeFlagGetter\(\s*'enablePreparedTextLayout',\s*false,?\s*\)/
    )
    expect(code('ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h')).toMatch(
      /bool enablePreparedTextLayout\(\) override \{\s*return false;\s*\}/
    )
    expect(code(`${featureFlags}/ReactNativeFeatureFlagsDefaults.kt`)).toMatch(
      /override fun enablePreparedTextLayout\(\): Boolean = false/
    )
    for (const overrides of [
      'ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android.kt',
      'ReactNativeFeatureFlagsOverrides_RNOSS_Canary_Android.kt',
      'ReactNativeFeatureFlagsOverrides_RNOSS_Experimental_Android.kt',
      'ReactNativeNewArchitectureFeatureFlagsDefaults.kt'
    ]) {
      expect({ overrides, sets: code(`${featureFlags}/${overrides}`).includes('enablePreparedTextLayout') }).toEqual({
        overrides,
        sets: false
      })
    }
  })
})
