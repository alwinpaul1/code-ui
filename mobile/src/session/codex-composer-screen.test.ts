// Whether Codex's composer is up, as far as a screen can show it.
//
// Codex draws its input with `›`, and so does a sent prompt, a popup's selected
// row and an approval's selected option, so that glyph alone says nothing. What
// a live composer has that the others do not is its footer row under it,
// indented two columns: `  <model> <effort> · <cwd>` in every captured Codex
// 0.155.1 and 0.158.0 screen of a ready or working composer, and none under an
// approval or the trust prompt. A shell prompt is at column 0.
//
// Screens: fixtures/codex-composer-screens.ts, which says which are real
// (0.155.1, 0.158.0) and which are modelled. Codex 0.153.4 has no screen
// capture here. NOT captured: Codex exited to a shell.

import { describe, expect, it } from 'vitest'
import { codexComposerLive } from './codex-composer-screen'
import {
  APPROVAL_0158,
  CODEX_EXITED_PROMPTS,
  codexExitedToShell,
  CONTEXT_LEFT_FOOTER,
  IDLE_AFTER_TURN_0158,
  plainShellScreen,
  QUOTED_IN_ANSWER_0158,
  STARTING_0158,
  TRUST_PROMPT_0158,
  withoutBlankRows,
  WORKING_0155,
  WORKING_0158
} from './fixtures/codex-composer-screens'

const READY: [string, string[]][] = [
  ['Codex 0.158.0 idle after a turn', IDLE_AFTER_TURN_0158],
  ['Codex 0.158.0 mid-turn', WORKING_0158],
  ['Codex 0.158.0 idle under an answer that quotes the busy row', QUOTED_IN_ANSWER_0158],
  ['Codex 0.155.1 mid-turn, whose footer is the last row', WORKING_0155]
]

describe('a Codex screen that shows its composer', () => {
  it.each(READY)('is live: %s', (_name, lines) => {
    expect(codexComposerLive(lines)).toBe(true)
  })

  it.each(READY)('is live with the blank rows Orca drops removed: %s', (_name, lines) => {
    expect(codexComposerLive(withoutBlankRows(lines))).toBe(true)
  })

  it('is live with a draft wrapped over two rows in the composer', () => {
    const wrapped = [
      ...WORKING_0158.slice(0, WORKING_0158.indexOf('› Ask Codex to do anything')),
      '› a long thought typed on the desk that wraps',
      '  onto a second row of the composer',
      '',
      ...WORKING_0158.slice(-2)
    ]
    expect(codexComposerLive(wrapped)).toBe(true)
  })

  it('is live with the context-left footer (modelled)', () => {
    expect(codexComposerLive(['• Working (3s • esc to interrupt)', ...CONTEXT_LEFT_FOOTER])).toBe(true)
  })
})

describe('a Codex screen that shows no composer', () => {
  it('is not live under the approval, whose selected option wears the composer glyph', () => {
    expect(codexComposerLive(APPROVAL_0158)).toBe(false)
  })

  it('is not live under the folder trust prompt', () => {
    expect(codexComposerLive(TRUST_PROMPT_0158)).toBe(false)
  })

  it('is not live before the composer exists (startup)', () => {
    expect(codexComposerLive(STARTING_0158)).toBe(false)
  })

  // Codex exited to a shell. NOT captured: modelled from the strings the 0.153.4
  // binary prints on exit, with the old frame left above.
  it.each([
    ['a zsh prompt', CODEX_EXITED_PROMPTS.zsh],
    ['a bash prompt', CODEX_EXITED_PROMPTS.bash],
    ['a column-0 prompt shaped like the footer (the model token has a hyphen)', CODEX_EXITED_PROMPTS.footerShaped]
  ])('is not live once Codex has exited to a shell: %s', (_name, prompt) => {
    expect(codexComposerLive(codexExitedToShell(WORKING_0158, prompt))).toBe(false)
    expect(codexComposerLive(codexExitedToShell(WORKING_0158, prompt, false))).toBe(false)
    expect(codexComposerLive(codexExitedToShell(WORKING_0155, prompt))).toBe(false)
  })

  it('is not live for a shell and nothing else', () => {
    expect(codexComposerLive(plainShellScreen(CODEX_EXITED_PROMPTS.zsh))).toBe(false)
    expect(codexComposerLive(plainShellScreen(CODEX_EXITED_PROMPTS.footerShaped))).toBe(false)
  })

  it('is not live when the footer is at column 0 under a `›` row', () => {
    expect(codexComposerLive(['› Ask Codex to do anything', 'gpt-6-sol medium · ~/repo'])).toBe(false)
  })

  it('is not live when a sent prompt is the last `›` row and no footer follows', () => {
    expect(codexComposerLive(['• done', '› List the files here', '', '• Working (0s • esc to interrupt)'])).toBe(false)
  })

  // Degenerate sizes: nothing at all, and the glyph alone.
  it('is not live for an empty screen, or a lone `›` row', () => {
    expect(codexComposerLive([])).toBe(false)
    expect(codexComposerLive(['›'])).toBe(false)
    expect(codexComposerLive(['› '])).toBe(false)
  })

  it('is live for the smallest screen that has both: the composer row and its footer', () => {
    expect(codexComposerLive(['› ', '  gpt-6-sol medium · ~/r'])).toBe(true)
  })
})
