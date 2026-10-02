// Whether Codex's composer is up, as far as a screen can show it.
//
// Codex draws its input with `›`, and so does a sent prompt, a popup's selected
// row and an approval's selected option, so that glyph alone says nothing. What
// the composer's `›` row has under it is indented rows only (the footer, a popup
// or a hint), where a shell's prompt is at column 0; an approval's or a
// picker's selected row is a numbered option or has a key hint under it.
// Every real capture of a ready or working composer (0.153.4 excerpt, 0.155.1,
// 0.158.0) also has an indented footer row `  <model> <effort> · <cwd>`, but the
// footer is not REQUIRED: a popup (modelled), a custom status line and a Windows
// path would each have refused a live composer for good.
//
// Screens: fixtures/codex-composer-screens.ts, which says which are real and
// which are modelled. NOT captured: Codex exited to a shell, a popup open.

import { describe, expect, it } from 'vitest'
import { codexComposerLive } from './codex-composer-screen'
import {
  APPROVAL_0158,
  LIVE_0153_S23,
  MODEL_PICKER_0153,
  POPUP_ABOVE_COMPOSER,
  POPUP_BELOW_COMPOSER,
  UNNUMBERED_PICKER,
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
  ['Codex 0.155.1 mid-turn, whose footer is the last row', WORKING_0155],
  ['the bottom of a live Codex 0.153.4 session (S23, 2026-09-09)', LIVE_0153_S23]
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

  it.each([
    ['a slash popup below the composer, no footer under it (modelled 0.153.4)', POPUP_BELOW_COMPOSER],
    ['a slash popup above the composer, its selected row wearing the glyph too (modelled 0.158)', POPUP_ABOVE_COMPOSER],
    ['a footer whose directory is a Windows path', ['› ', '  gpt-5.6-sol medium · D:\\work\\proj']],
    ['a custom status line with another item before the directory', ['› ', '  gpt-5.6-sol medium · main · ~/p']],
    ['a footer whose model id has no digit or hyphen', ['› ', '  codex medium · ~/p']],
    ['the hint Codex draws for a second Esc', ['› ', '  esc again to edit previous message']],
    ['the hint Codex draws for a second Ctrl+C', ['› ', '  ctrl + c again to quit']]
  ])('is live with %s', (_name, lines) => {
    expect(codexComposerLive(lines)).toBe(true)
  })

  it('is live with the chat\'s own draft answering by number typed into it', () => {
    expect(
      codexComposerLive(['• ok', '› 1. Yes, use postgres', '  2. No caching for now', '  gpt-5.6-sol xhigh · ~/Project'])
    ).toBe(true)
  })

  it('is live with the context-left footer (modelled)', () => {
    expect(codexComposerLive(['• Working (3s • esc to interrupt)', ...CONTEXT_LEFT_FOOTER])).toBe(true)
  })
})

describe('a Codex screen that shows no composer', () => {
  it('is not live under the approval, whose selected option wears the composer glyph', () => {
    expect(codexComposerLive(APPROVAL_0158)).toBe(false)
  })

  it('is not live under the real 0.153.4 /model picker, whose selected row wears the glyph and whose hint is drawn', () => {
    expect(codexComposerLive(MODEL_PICKER_0153)).toBe(false)
  })

  it('is not live under a picker whose selected row is not numbered but whose key hint is drawn (modelled)', () => {
    expect(codexComposerLive(UNNUMBERED_PICKER)).toBe(false)
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
  it('is not live for an empty screen, or one with no composer row', () => {
    expect(codexComposerLive([])).toBe(false)
    expect(codexComposerLive([''])).toBe(false)
    expect(codexComposerLive(['  gpt-6-sol medium · ~/r'])).toBe(false)
  })

  it('is live for the smallest screens: the composer row alone, and with its footer', () => {
    expect(codexComposerLive(['› Ask Codex to do anything'])).toBe(true)
    expect(codexComposerLive(['› ', '  gpt-6-sol medium · ~/r'])).toBe(true)
  })

  // A follow onto a new terminal wants more, as Claude's does (claudeLiveFrame): the composer
  // alone is not shown to be a whole frame, because a restored terminal is seeded with an
  // old one.
  it('is a live frame for a follow only with a row drawn under the composer', () => {
    expect(codexComposerLive(['› Ask Codex to do anything'], { underneath: true })).toBe(false)
    expect(codexComposerLive(['› ', '  gpt-6-sol medium · ~/r'], { underneath: true })).toBe(true)
    expect(codexComposerLive(WORKING_0158, { underneath: true })).toBe(true)
    expect(codexComposerLive(codexExitedToShell(WORKING_0158, '66% '), { underneath: true })).toBe(false)
  })
})
