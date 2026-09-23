import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  buildTerminalDocumentScript,
  emitTerminalDocumentModule
} from '../../../scripts/build-terminal-document-script.mjs'
import { TERMINAL_DOCUMENT_MODULE_ORDER } from '../../../scripts/terminal-document-module-order.mjs'
import { compareTerminalDocumentScripts } from './terminal-document-equivalence.test-support'

/**
 * The review of the move, as one number per difference class.
 *
 * `terminal-document-pre-flip-script.txt` is the hand-written script exactly as it stood before any
 * of this, taken from the byte fixture that pinned it. This says the modules emit the same program
 * modulo the qualifier and the repository's own rules rewriting an ES5 document the moment its
 * source is a linted module. Anything outside those classes refuses with the token index and both
 * sides, so a reordered statement, a changed literal or a renamed local cannot pass here.
 *
 * The scope object is the one thing the emitted script has that the document did not, so it is
 * pinned on its own below rather than folded into a count.
 *
 * Retirement, per ruling 18: this test is the proof of the flip and holds only while no module
 * changes, so the first lane that must change one retires it together with
 * `terminal-document-pre-flip-script.txt`, and the standing pin from then on is
 * `terminal-document-identity.test.ts`, whose fixture regeneration is a review event.
 */
const preFlipScript = readFileSync(
  new URL('../terminal-document-pre-flip-script.txt', import.meta.url),
  'utf8'
)

describe('the whole terminal document script', () => {
  it('is what the modules emit, modulo the eight counted classes', async () => {
    const emitted = await Promise.all(
      TERMINAL_DOCUMENT_MODULE_ORDER.map((name) =>
        emitTerminalDocumentModule(fileURLToPath(new URL(`./${name}.ts`, import.meta.url)))
      )
    )
    const candidate = `(function() {\n${emitted.join('\n')}\n})();`
    expect(compareTerminalDocumentScripts(preFlipScript, candidate, 'scope')).toEqual({
      equivalent: true,
      // Code UI: measured over this fork's own pre-flip script, which carries its terminal work
      // (write hold and pump, paint-synced scroll remainder, settle, overscroll bend, per-ms
      // momentum, cached surface metrics, theme-key skip, local DECRQM answer). Upstream's
      // figures, over its shorter script, are in the comment beside each count.
      normalisations: {
        // The qualifier, partitioned: 695 reads and writes of a name whose declaration stayed put,
        // and 85 declarations that moved onto the scope object. 780 sites in all. (Upstream 609
        // and 73.)
        qualifiedReferences: 695,
        scopeFieldDeclarations: 85,
        // The document's 510 `var` declarators, less the 85 that became scope fields. (Upstream
        // 373 of 446.)
        rebindings: 425,
        // `curly`, measured over the whole script. (Upstream 279.)
        bracedBodies: 321,
        // Of the document's 41 catch clauses, two name their error and report it, so they keep it.
        // (Upstream 36 of 38.)
        unboundCatches: 39,
        // `unicorn/prefer-number-properties`, also measured up front. (Upstream 17.)
        numberProperties: 17,
        // Two SGR mode flags written twice each: shorthand cannot survive a qualified value.
        shorthandProperties: 4,
        // Names the printer had to disambiguate while an outer binding of the same name existed:
        // `attachTerminalQueryReplyBridge`'s `term` (7) and, in this fork, `decrqmModeState`'s
        // `term` with the DECRQM handler's three uses of the bridge's own (10). (Upstream 7.)
        unshadowedNames: 17
      }
    })
  })

  it('adds the scope object and nothing else', async () => {
    const script = await buildTerminalDocumentScript()
    const emitted = await Promise.all(
      TERMINAL_DOCUMENT_MODULE_ORDER.map((name) =>
        emitTerminalDocumentModule(fileURLToPath(new URL(`./${name}.ts`, import.meta.url)))
      )
    )
    const body = emitted.join('\n')
    const at = script.indexOf(body)
    expect(at).toBeGreaterThan(-1)
    const preamble = script.slice('(function() {\n'.length, at)
    expect(script.slice(at + body.length)).toBe('\n})();')
    expect(preamble).toContain('function createTerminalDocumentScope()')
    expect(preamble).toContain('const scope = createTerminalDocumentScope();')
    expect(preamble.split('createTerminalDocumentScope').length - 1).toBe(2)
  })
})
