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
// 2026-09-19, Orca #20919 ported: the screen-holdout migration takes the last two sends out of
// this family — the filter sheet's linear.selectWorkspace and the screen-root hook's repo.list.
// Hook, statement, declaration, render and style counts are all unchanged, and `semantics` is a
// pure deletion of four lines, none in — two `rpc:` call signatures and the two method literals
// they carried (3301 → 3297, checked by diffing the reader's output against the pre-port tree).
// The render-token hash moves because the picker's handler now names an operation instead of the
// client. The hooks hash is again upstream's own value (SCREEN_RPC_SCREEN_HOOKS there).
// 2026-09-19, Orca #21169 ported: checked readers on the item and list operations delete the reply
// casts these consumers carried and the three shape tests the reader now answers for, the reaction
// reader forwards `content` instead of matching mobile's invented arm set, and eight alias-only
// bindings the deleted casts left are inlined. Hook, statement, declaration and render counts are
// unchanged; `semantics` 3297 → 3275 is 23 literals out and one `''` in (the eight reaction arms,
// the mergeable/viewed/status arms, both "Invalid checks response" strings, "number", "reactions",
// "content", "status"), checked against the pre-port tree, and the render-token hash does not
// move. The hooks hash is upstream's own value once more; statements and declarations are this
// fork's.
// 2026-09-19, Orca #21246 ported: the board, runtime, search, workspace-source and workspace-create
// operations are checked too, which deletes the collection casts the project pane and the assignee
// list carried, the Linear list cast, and one inline cast type; the hook and statement hashes also
// move for `SAFETY:` comment text nested inside statements. Counts hold at 350, 417 and 194.
// `semantics` 3275 → 3271 is exactly the four literals inside the deleted cast type (`'DISMISSED'`,
// `'VIEWED'`, `'UNVIEWED'`, `'status'`), checked against the pre-port tree; the render-token hash
// does not move. The hooks hash is upstream's own value once more.
// 2026-09-27 (theme pass 2, the Tasks surface onto the live theme): every file here took `colors`
// from mobile-tasks-dependencies, which re-exported the dark-only static palette, and the seven
// StyleSheets were built from it at module load, so a light session drew the whole screen dark.
// Each pin below moved for that and nothing else, checked by dumping every reader's output before
// and after and diffing: stage one binds `useTheme()` and `useThemedStyles(mobileTasksStyles)` onto
// the model (hooks 351 -> 353, statements 418 -> 420); render functions destructure `colors` and
// `styles` from the model; the helpers that drew a colour take the palette (`githubProjectOptionColor`,
// `taskRepositoryMeta`, the Linear grouping, `renderCommentReactions`, `getPrSignalToneStyle`,
// `getGitLabPipelineStatusStyle`), and three memos list it in their deps. New declarations: the
// cached `mobileTasksStyles` factory with its builder, type and cache, `taskRepositoryLabel` (split
// out so sorting needs no palette) and `ProviderPickerLogo` (the provider picker's themed logo), so
// 194 -> 200. `semantics` 3,271 -> 3,275: three `jsx:ProviderPickerLogo` signatures in place of two
// net `jsx:TaskProviderLogo` ones, and the three provider literals `taskRepositoryLabel` compares.
// The render tree gains seven `colors`/`styles` argument tokens (35,299 -> 35,306) and renames the
// static tokens (`textPrimary` -> `text` and the rest) one for one. The StyleSheet reader differs
// only by those renames: mapping the old output through the rename table reproduces the new one.
const PROVIDER_RPC_SCREEN_HOOKS = 'd9b357813a15ca094d9df767cecce3081bbbe9a8c59e6678633c99e3199acb90'
// 2026-09-27 (theme pass 2): GitHubPrFileDiff reads `useTheme().syntax` for its code spans, which
// had fallen back to MobileSyntaxSegments' Dark+ default in both schemes. One hook, 3 -> 4.
// Later the same day it reads `useThemedStyles(mobileTasksStyles)` too, 4 -> 5 (see the note above).
const PRE_REFACTOR_DIFF_HOOKS = '62c82feed348183b33ac0a088db44dc57d94ec2dc57e3d4a9cebba852ebcf89b'
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
// 2026-09-19, Orca #21694 (OTA C2.1), the same three movements upstream records for it and
// nothing else: the workspace-creation push moves onto `hostNewWorktreeSessionRoute`, which
// already built the href with both segments encoded — the hook list and the statement hash
// move because the handler's statements changed shape, and `semantics` loses exactly the two
// lines it deletes (the `URLSearchParams` construction and the raw `/h/${hostId}/session/...`
// template, 3 271 → 3 269); and the two clipboard writes move onto the platform seam, so the
// comment-review hook gains one hook call (350 → 351) and one statement (417 → 418). No RPC
// call, method literal or JSX host signature changed, and the render and style pins hold. The
// hook hash lands on upstream's own value for this commit (0f66df21); statements and semantics
// stay this fork's, since the tree carries the press-feedback and tap-target hunks above.
// 2026-09-27 (theme pass 2): 418 -> 420; see the note above PROVIDER_RPC_SCREEN_HOOKS.
const PROVIDER_RPC_STATEMENTS = 'd8aa570be802c51fcae7051b713b81ac5b6666df2494c252a1243e489bae3056'
// 2026-09-26, the code viewer's face sweep: the PR file diff's "+ "/"- " prefix is a nested Text
// inside the monospace code line, and with no face of its own the app's Instrument Sans default
// drew it proportional, so the code after it shifted row to row. It now takes
// `styles.diffLinePrefix` (the code face). Three pins move with that and nothing else:
// GitHubPrFileDiff's declaration (the one JSX attribute, 194 declarations still), `semantics`
// (that `jsx:Text:` host signature becomes `jsx:Text:style`, 3,271 lines still) and the
// StyleSheets (the one `diffLinePrefix` key). Hooks, statements and the render tree hold;
// diff-line-prefix-face.test.tsx guards the face.
// 2026-09-27 (theme pass 2): GitHubPrFileDiff's declaration gains the `useTheme()` line and the
// `palette={syntax}` attribute on its <MobileSyntaxSegments>. 194 declarations still.
// Later the same day, the Tasks surface onto the live theme: 194 -> 200 (note above the hooks pin).
const PRESS_FEEDBACK_DECLARATIONS = 'dfeee267e57463591730cc85d504e558b4833b902e56bd4b37a1c20d1323df37'
// 2026-09-19: the two Platform.select monospace stacks in the tasks styles
// became typography.monoFamily (the bundled code face — 'monospace' is not
// monospace on a Samsung), and their Platform imports went with them: 6 lines.
// 2026-09-21, upstream #21715 (C2.8): the status bar's Back control gains `accessibilityRole="button"`
// and `accessibilityLabel="Back"`, for a shell with no native chrome behind it to announce one. On this
// fork's TasksButton (which already carried the hitSlop upstream added there) that is the two JSX props
// only: `semantics` 3,269 -> 3,271 (the host signature widens and the two strings "button" and "Back"
// arrive); the render-token stream gains the eight tokens the two attributes are, 35,291 -> 35,299.
// Hooks, statements, declarations and styles do not move.
// 2026-09-26: the PR diff prefix's style attribute; see the declarations pin above.
// 2026-09-27 (theme pass 2): that diff's `jsx:MobileSyntaxSegments:segments` host signature
// becomes `…:segments,palette`. 3,271 lines still.
// Later the same day: 3,271 -> 3,275 (note above the hooks pin).
const A11Y_BACK_SEMANTICS = 'f0d5906e596b6f7e08c1cd398fc96d47d6b75971be8313cb2a4fca41277084fe'
// 2026-09-26: `diffLinePrefix`, the prefix's code face; see the declarations pin above.
// 2026-09-27 (theme pass 2): the static token names become the live theme's (note above the hooks pin).
const PRE_REFACTOR_STYLES = '4c7a827406eab7fc071920185d4007d77d69dbc24821952a647a30c7e35351c3'
// 2026-09-27 (theme pass 2): 35,299 -> 35,306 (note above the hooks pin).
const A11Y_BACK_RENDER_TREE = '6bde687376965123d7a936746b7216d0493f78b5c73cd01428debf6b2977509f'

describe('Mobile Tasks refactor parity', () => {
  it('preserves recursively flattened hook and dependency order', () => {
    const screenHooks = readFlattenedMobileTasksHookSignatures('MobileTasksScreen')
    expect(screenHooks).toHaveLength(353)
    expect(hash(screenHooks)).toBe(PROVIDER_RPC_SCREEN_HOOKS)

    const diffHooks = readFlattenedMobileTasksHookSignatures('GitHubPrFileDiff')
    expect(diffHooks).toHaveLength(5)
    expect(hash(diffHooks)).toBe(PRE_REFACTOR_DIFF_HOOKS)
  })

  it('preserves every screen statement in execution order', () => {
    const statements = readFlattenedMobileTasksCoreStatements()
    expect(statements).toHaveLength(420)
    expect(hash(statements)).toBe(PROVIDER_RPC_STATEMENTS)
  })

  it('preserves every moved top-level declaration', () => {
    const declarations = readMobileTasksDeclarationSignatures()
    expect(declarations).toHaveLength(200)
    expect(hash(declarations)).toBe(PRESS_FEEDBACK_DECLARATIONS)
  })

  it('preserves RPC calls, runtime strings, and JSX host signatures', () => {
    const semantics = readMobileTasksSemanticSource()
    expect(semantics.split('\n')).toHaveLength(3_275)
    expect(hash(semantics)).toBe(A11Y_BACK_SEMANTICS)
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
    expect(tokens).toHaveLength(35_306)
    expect(hash(tokens)).toBe(A11Y_BACK_RENDER_TREE)
  })

  it('preserves every StyleSheet property and value', () => {
    expect(hash(readMobileTasksStyleSource())).toBe(PRE_REFACTOR_STYLES)
  })
})
