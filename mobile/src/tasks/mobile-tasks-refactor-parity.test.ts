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
// 2026-09-19, Orca #20685 ported: the provider item, detail, list and GitHub Projects board half
// sends through operations too (70 raw-port references across 22 files to zero). The hook and
// statement hashes move because both readers capture the effect and callback bodies the send left;
// their counts hold at 350 and 417. `semantics` is a pure deletion, 148 lines out and none in —
// the same 148 upstream lost: 70 `rpc:` call signatures, 75 method literals over 58 methods and
// three duplicated `item.source.type` comparisons — 3449 → 3301, checked by diffing the reader's
// output against the pre-port tree. Declarations, the render tree and the StyleSheets are
// byte-identical. The hooks hash is upstream's own PROVIDER_RPC_SCREEN_HOOKS value, since the
// migrated hooks are byte-identical to upstream's; the statement and semantics hashes are this
// fork's because its tap-target and press-feedback hunks sit in the same readers.
const PROVIDER_RPC_SCREEN_HOOKS = '7af4478d440cd913770b8a2d5e96c33aaf956192d2a820787af0727a0f33c018'
const PRE_REFACTOR_DIFF_HOOKS = '93c7189b32bed8456cc51814fffa8ce80cf62011ef968a9d53ddec2b9686f58f'
// 0.6.7 press feedback: every static-style `<Pressable>` on the surface (135 of them) became a
// `<TasksRow>` or `<TasksButton>` from mobile-tasks-pressables, which is where the pressed state
// is now drawn. That is a behaviour change, not a refactor, and the pins below moved with it:
// statements and declarations rename a tag and swap an import in 29 files at the same counts;
// `semantics` gains exactly the new module's two `jsx:PressFeedback` signatures and its one
// `'pressedStyle'` literal (3452 → 3455); the render tree renames the same tags at the same
// token count. Hooks and the StyleSheets are untouched and still match their earlier pins.
// mobile-tasks-press-feedback.test.tsx is what guards the rows from here on.
// 0.6.7 tap targets, the same release: the NINE controls drawn at 40 dp or less (the 32 dp back
// button, three 32 dp icon buttons — two in the status bar and one in the item drawer — the
// 32 × 30 view-link segment, the 44 × 38 pagination pair, the 32 dp comment send button and the
// 40 dp paste button) gained `hitSlop={tapTargetHitSlop(styles.<key>)}`, which is one more
// attribute on nine `jsx:` signatures at the same count, one import per file, and 80 more render
// tokens (35 195 → 35 275). src/ui/tap-target-audit.test.ts guards them from here.
// (Said "eight" twice and named only eight, omitting the item-drawer icon button; a review caught
// the arithmetic. `grep -c tapTargetHitSlop src/tasks/*.tsx` sums to nine.)
// 0.7.0, from a review of the above: the ONE TasksRow that rests on bgRaised (the selected
// GitHub page picker row) took the lift in the colour it was already wearing, so the row a user
// had chosen acknowledged no press while every row around it did — the exact thing this release
// set out to fix, and invisible because `pickerRowSelected` and `taskRowPressed` are the same
// token. TasksRow gained a `raised` prop and the StyleSheet a `taskRowPressedOnRaised` key, which
// moves `semantics` (one more jsx: attribute and the new literal), the StyleSheet pin (one new
// key) and the render tree (+4). The statements and declarations pins do not move.
const PROVIDER_RPC_STATEMENTS = '2aaf39554c761d1d73728b401449053b405eb7142f78dcd51a693ba68259ba8d'
const PRESS_FEEDBACK_DECLARATIONS = 'a9c4420f0350cbc6c623e02a7d8b114cb3de76e2099498be72fbc7d6d0c0240a'
// 2026-09-19: the two Platform.select monospace stacks in the tasks styles
// became typography.monoFamily (the bundled code face — 'monospace' is not
// monospace on a Samsung), and their Platform imports went with them: 6 lines.
const PROVIDER_RPC_SEMANTICS = '1b1be26096a48f59297a3056a1cae803e7faf6661655432959af120fe6b71a8e'
const PRE_REFACTOR_STYLES = 'b73e6defde3651f586eda5d9833e5de70b250aa8fbdb453cc40751844e8f5250'
const TAP_TARGET_RENDER_TREE = 'ee1e8e3181777d7764c0cad5909d60de997f5aa6f05688952285623d6b392ce9'

describe('Mobile Tasks refactor parity', () => {
  it('preserves recursively flattened hook and dependency order', () => {
    const screenHooks = readFlattenedMobileTasksHookSignatures('MobileTasksScreen')
    expect(screenHooks).toHaveLength(350)
    expect(hash(screenHooks)).toBe(PROVIDER_RPC_SCREEN_HOOKS)

    const diffHooks = readFlattenedMobileTasksHookSignatures('GitHubPrFileDiff')
    expect(diffHooks).toHaveLength(3)
    expect(hash(diffHooks)).toBe(PRE_REFACTOR_DIFF_HOOKS)
  })

  it('preserves every screen statement in execution order', () => {
    const statements = readFlattenedMobileTasksCoreStatements()
    expect(statements).toHaveLength(417)
    expect(hash(statements)).toBe(PROVIDER_RPC_STATEMENTS)
  })

  it('preserves every moved top-level declaration', () => {
    const declarations = readMobileTasksDeclarationSignatures()
    expect(declarations).toHaveLength(194)
    expect(hash(declarations)).toBe(PRESS_FEEDBACK_DECLARATIONS)
  })

  it('preserves RPC calls, runtime strings, and JSX host signatures', () => {
    const semantics = readMobileTasksSemanticSource()
    expect(semantics.split('\n')).toHaveLength(3_301)
    expect(hash(semantics)).toBe(PROVIDER_RPC_SEMANTICS)
  })

  // 35_287 -> 35_291: `raised={selected}` on the GitHub page picker row, four
  // tokens. See the selected-row note above the pins.
  // 35_275 -> 35_287: +12 = SIX tokens each on the TWO calls this family sees.
  // `grep -c horizontalGap src/tasks/*.tsx` is 2; the other eight uses live
  // outside src/tasks and cannot move this count. (A reviewer read the +12 as
  // two tokens across all six files and could not reconcile it, which is the
  // argument for stating the arithmetic against a command rather than a claim.)
  // Both calls are `tapTargetHitSlop(styles.iconButton)` in
  // mobile-tasks-screen-chrome gained a `{ horizontalGap: 0 }` argument, six
  // tokens each. The statusBar row sets no gap, so without the cap the Create
  // button's hitSlop covered the right sixth of the Refresh button's drawn
  // pixels and a tap on Refresh opened the create drawer.
  it('preserves render expressions and event handlers in tree order', () => {
    const tokens = readFlattenedMobileTasksRenderTokens()
    expect(tokens).toHaveLength(35_291)
    expect(hash(tokens)).toBe(TAP_TARGET_RENDER_TREE)
  })

  it('preserves every StyleSheet property and value', () => {
    expect(hash(readMobileTasksStyleSource())).toBe(PRE_REFACTOR_STYLES)
  })
})
