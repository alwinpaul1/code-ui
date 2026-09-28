import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodePillCopyNativeId, PILL_COPY_ID_PREFIX, SELECTION_COPY_MODULE } from './markdown-pill-copy-id'

// The two halves of the Android selection Copy fix (2026-09-28, "someone runs `cdk deploy`."
// pasted as "someone runs ￼."): JS writes each pill's span on its View's nativeID, and
// modules/orca-selection-copy reads it back when Copy is tapped. Nothing but these strings joins
// them, and the Kotlin half has no test in this gate, so the strings are pinned from both sides:
// here, and in PillCopyTest.kt.

const MODULE_DIR = path.resolve(import.meta.dirname, '../../modules/orca-selection-copy')
const KOTLIN_DIR = path.join(MODULE_DIR, 'android/src/main/java/expo/modules/orcaselectioncopy')

/** A Kotlin file's code with its comments taken out, so a match is never prose. */
function kotlin(file: string): string {
  return readFileSync(path.join(KOTLIN_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the pill copy text a pill View carries', () => {
  it('writes the nativeIDs the Android copy reads back (PillCopyTest.kt reads these strings)', () => {
    expect(encodePillCopyNativeId('cdk deploy', 0)).toBe('codeui-pill:0:cdk deploy')
    expect(encodePillCopyNativeId('a:b c', 12)).toBe('codeui-pill:12:a:b c')
  })

  it('writes the prefix the Kotlin reader looks for', () => {
    const declared = /const val NATIVE_ID_PREFIX = "([^"]*)"/.exec(kotlin('PillCopy.kt'))?.[1]
    expect(declared).toBe(PILL_COPY_ID_PREFIX)
  })
})

describe('the native module the Android root comes from', () => {
  it('is registered under the name JS asks for, with the root view in it', () => {
    const module = kotlin('OrcaSelectionCopyModule.kt')
    expect(/Name\("([^"]+)"\)/.exec(module)?.[1]).toBe(SELECTION_COPY_MODULE)
    expect(module).toMatch(/class OrcaSelectionCopyModule : Module\(\)/)
    expect(module).toMatch(/View\(SelectionCopyRootView::class\)/)
    const config = JSON.parse(readFileSync(path.join(MODULE_DIR, 'expo-module.config.json'), 'utf8')) as {
      platforms: string[]
      android: { modules: string[] }
    }
    expect(config.platforms).toEqual(['android'])
    expect(config.android.modules).toEqual(['expo.modules.orcaselectioncopy.OrcaSelectionCopyModule'])
  })

  it('is a ReactViewGroup that takes the selection menus of the Texts inside it', () => {
    const root = kotlin('SelectionCopyRootView.kt')
    expect(root).toMatch(/class SelectionCopyRootView\(context: Context\) : ReactViewGroup\(context\)/)
    expect(root).toMatch(/override fun startActionModeForChild\(/)
    // Copy is the one it takes over; Share hands out the same text.
    const menu = kotlin('SelectionCopyActionModeCallback.kt')
    expect(menu).toMatch(/android\.R\.id\.copy ->/)
    expect(menu).toMatch(/android\.R\.id\.shareText ->/)
    // Expo builds the view by reflection; a minified build must keep the constructor it looks for.
    const keep = readFileSync(path.join(MODULE_DIR, 'android/proguard-rules.pro'), 'utf8').replace(/^#.*$/gm, '')
    expect(keep).toMatch(/-keep class expo\.modules\.orcaselectioncopy\.SelectionCopyRootView \{\s*public <init>\(android\.content\.Context\);\s*\}/)
    expect(readFileSync(path.join(MODULE_DIR, 'android/build.gradle'), 'utf8')).toMatch(/^\s*consumerProguardFiles 'proguard-rules\.pro'$/m)
  })
})
