import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  readFlattenedMobileTasksHookSignatures,
  readMobileTasksSemanticSource,
  readMobileTasksStyleSource
} from './mobile-tasks-source-family.test-support'
import { readFlattenedMobileTasksRenderTokens } from './mobile-tasks-render-parity.test-support'
import {
  readFlattenedMobileTasksCoreStatements,
  readMobileTasksDeclarationSignatures
} from './mobile-tasks-execution-parity.test-support'

const hash = (parts: string[] | string): string =>
  createHash('sha256')
    .update(Array.isArray(parts) ? parts.join('\n') : parts)
    .digest('hex')

// Bound workspace-creation requests change source signatures the same way bound settings requests
// did: the method string and the envelope read leave the screen and an operation name arrives. The
// behaviour they used to pin is pinned by the recordings in mobile/rpc-foundation/goldens instead,
// which did not move. Statement, declaration, render and style counts are unchanged; `semantics`
// loses exactly the 22 `rpc:` signatures and 22 method literals the migration deleted.
const WORKSPACE_RPC_SCREEN_HOOKS =
  '26ed5700089a9de13ea984274eb10ddea62f72b28135992514e3c16ef8e47e30'
const PRE_REFACTOR_DIFF_HOOKS = '93c7189b32bed8456cc51814fffa8ce80cf62011ef968a9d53ddec2b9686f58f'
// 0.6.7 press feedback: every static-style `<Pressable>` on the surface (135 of them) became a
// `<TasksRow>` or `<TasksButton>` from mobile-tasks-pressables, which is where the pressed state
// is now drawn. That is a behaviour change, not a refactor, and the pins below moved with it:
// statements and declarations rename a tag and swap an import in 29 files at the same counts;
// `semantics` gains exactly the new module's two `jsx:PressFeedback` signatures and its one
// `'pressedStyle'` literal (3452 → 3455); the render tree renames the same tags at the same
// token count. Hooks and the StyleSheets are untouched and still match their earlier pins.
// mobile-tasks-press-feedback.test.tsx is what guards the rows from here on.
// 0.6.7 tap targets, the same release: the eight controls drawn at 40 dp or less (the 32 dp back
// and icon buttons, the 32 × 30 view-link segment, the 44 × 38 pagination pair, the 32 dp comment
// send button, the 40 dp paste button) gained `hitSlop={tapTargetHitSlop(styles.<key>)}`, which
// is one more attribute on eight `jsx:` signatures at the same count, one import per file, and
// 80 more render tokens (35 195 → 35 275). src/ui/tap-target-audit.test.ts guards them from here.
const TAP_TARGET_STATEMENTS = 'd7350b217e5d774c7c2ebea307babb6beb91ebf9ef73cd1d76f38b8b9ebe8dc8'
const PRESS_FEEDBACK_DECLARATIONS = 'a9c4420f0350cbc6c623e02a7d8b114cb3de76e2099498be72fbc7d6d0c0240a'
const TAP_TARGET_SEMANTICS = 'e1610b05ef4dfee1b2685c5a9e6de24e6e9e5f1edccd771b92c0d0be86b5841f'
const PRE_REFACTOR_STYLES = '1db6af69c791d9963928541ad5310942fcbda6d984b422c90b6eb92b6816579a'
const TAP_TARGET_RENDER_TREE = 'e35bc375a8e8d57261a1c58bf4ac032e8930f9fcc957f96ea1797104fe64b72b'

describe('Mobile Tasks refactor parity', () => {
  it('preserves recursively flattened hook and dependency order', () => {
    const screenHooks = readFlattenedMobileTasksHookSignatures('MobileTasksScreen')
    expect(screenHooks).toHaveLength(350)
    expect(hash(screenHooks)).toBe(WORKSPACE_RPC_SCREEN_HOOKS)

    const diffHooks = readFlattenedMobileTasksHookSignatures('GitHubPrFileDiff')
    expect(diffHooks).toHaveLength(3)
    expect(hash(diffHooks)).toBe(PRE_REFACTOR_DIFF_HOOKS)
  })

  it('preserves every screen statement in execution order', () => {
    const statements = readFlattenedMobileTasksCoreStatements()
    expect(statements).toHaveLength(417)
    expect(hash(statements)).toBe(TAP_TARGET_STATEMENTS)
  })

  it('preserves every moved top-level declaration', () => {
    const declarations = readMobileTasksDeclarationSignatures()
    expect(declarations).toHaveLength(194)
    expect(hash(declarations)).toBe(PRESS_FEEDBACK_DECLARATIONS)
  })

  it('preserves RPC calls, runtime strings, and JSX host signatures', () => {
    const semantics = readMobileTasksSemanticSource()
    expect(semantics.split('\n')).toHaveLength(3_455)
    expect(hash(semantics)).toBe(TAP_TARGET_SEMANTICS)
  })

  // 35_275 -> 35_287: two `tapTargetHitSlop(styles.iconButton)` calls in
  // mobile-tasks-screen-chrome gained a `{ horizontalGap: 0 }` argument, six
  // tokens each. The statusBar row sets no gap, so without the cap the Create
  // button's hitSlop covered the right sixth of the Refresh button's drawn
  // pixels and a tap on Refresh opened the create drawer.
  it('preserves render expressions and event handlers in tree order', () => {
    const tokens = readFlattenedMobileTasksRenderTokens()
    expect(tokens).toHaveLength(35_287)
    expect(hash(tokens)).toBe(TAP_TARGET_RENDER_TREE)
  })

  it('preserves every StyleSheet property and value', () => {
    expect(hash(readMobileTasksStyleSource())).toBe(PRE_REFACTOR_STYLES)
  })
})
