import { describe, expect, it } from 'vitest'
import { buildTerminalDocumentScript } from '../../../scripts/build-terminal-document-script.mjs'
import { TERMINAL_DOCUMENT_SCRIPT } from '../terminal-webview-document-script.generated'

/**
 * Every terminal suite reads the generated script, not the modules it is built from.
 *
 * Code UI: the batch C review found the gate passing against a stale copy. With
 * `overscrollBend` broken in its module and the generator not rerun, 79 terminal files still
 * passed, because they boot `terminal-webview-document-script.generated.ts`, which only
 * postinstall rebuilds, and a local Android build ships that same stale script.
 * `native-document-bundle.test.ts` (#21878) compares the two as well, but inside its bundle
 * census, and it fails with two truncated 110 KB strings. This case owns the one fact and says in
 * its failure what went wrong and what to run.
 */
describe('the generated terminal document script', () => {
  it('is a fresh build of the document modules, so the gate cannot pass against a stale copy', async () => {
    const fresh = await buildTerminalDocumentScript()
    const stale = TERMINAL_DOCUMENT_SCRIPT !== fresh
    expect(
      stale,
      'terminal-webview-document-script.generated.ts was built from older document modules, so ' +
        'every terminal suite is testing the old code. Run `node scripts/build-terminal-document-script.mjs` ' +
        '(pnpm postinstall runs it) and re-run the gate.'
    ).toBe(false)
  }, 30_000)
})
