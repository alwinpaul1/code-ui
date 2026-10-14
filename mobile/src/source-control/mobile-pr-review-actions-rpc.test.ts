import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { censusSourceFiles } from '../test-support/census-source-files'

/**
 * Approve, Request changes and Undraft on a pull request, which the Claude app's PR detail has
 * (`sjj` in com.anthropic.claude 1.261009.20: `ccr_pr_approve`, `ccr_pr_request_changes` with
 * `ccr_pr_request_changes_reason_label`, `ccr_pr_mark_ready` reading "Undraft"), and which Code UI
 * does not draw. This pins why, so the omission is a recorded fact and not an oversight.
 *
 * "Where Orca's hosted-review RPCs support them", and never an invented one: a phone may call only
 * what is catalogued AND on the host's mobile-scope allowlist (orca-mobile-rpc-allowlist.test.ts
 * explains the gate). Read off the catalog and the recorded 1.4.205 allowlist:
 *
 * - Approve and Request changes have no RPC at all. Orca's catalog has the inline review comment
 *   (`github.addPRReviewComment`), reviewer requests, merge, close and reopen, and nothing that
 *   submits a review with a verdict. A button for either would have no call to make.
 * - Undraft has one, `github.markPRReadyForReview`, catalogued and refused to a phone on 1.4.205:
 *   its absence from the allowlist is the "Method ... is not available to mobile clients" refusal.
 *   Drawing it without asking the host first is the defect the ratchet exists for. The way in is
 *   `host-mobile-capabilities.ts`: a third probe key (with its operation in
 *   host-mobile-capability-operations.ts, its exception in the allowlist ratchet and its reader
 *   counted in unchecked-rpc-reader-inventory.ts), the PR mutation wrapper beside `fetchMergePR`,
 *   and a `hostId` threaded to `MobilePRSidebar`, which has none today.
 *
 * Each assertion below fails when Orca moves, with what to do about it. The method is named here
 * and nowhere in `src`: a name in `src` would have to be allowlisted or probed first.
 */

const mobileRoot = fileURLToPath(new URL('../..', import.meta.url))
const catalogPath = join(
  mobileRoot,
  '..',
  'src',
  'shared',
  'rpc-contract',
  'rpc-params-catalog.generated.ts'
)
const fixturePath = join(
  mobileRoot,
  'src',
  'transport',
  'fixtures',
  'orca-mobile-rpc-allowlist-1.4.205.json'
)

const UNDRAFT_METHOD = 'github.markPRReadyForReview'

/** The keys of the generated `RPC_PARAMS_BY_METHOD` object literal: the host's registry. */
function readCatalogMethods(): string[] {
  const sourceFile = ts.createSourceFile(
    catalogPath,
    readFileSync(catalogPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  const methods: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'RPC_PARAMS_BY_METHOD' &&
      node.initializer
    ) {
      const literal = ts.isAsExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer
      if (ts.isObjectLiteralExpression(literal)) {
        for (const property of literal.properties) {
          if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name)) {
            methods.push(property.name.text)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return methods
}

const catalog = readCatalogMethods()
const allowlist = new Set(
  (JSON.parse(readFileSync(fixturePath, 'utf8')) as { methods: string[] }).methods
)

/** A hosted-review RPC that would submit a review with a verdict, by what it is called. */
function submitsAVerdict(method: string): boolean {
  return /approve/i.test(method) || /request.?changes/i.test(method) || /(submit|create)\w*review\b/i.test(method)
}

describe('the pull request actions the Claude app has and Code UI does not draw', () => {
  it('reads a catalog large enough to mean something, with the PR actions Code UI does draw', () => {
    expect(catalog.length).toBeGreaterThan(500)
    for (const drawn of [
      'github.mergePR',
      'github.updatePRState',
      'github.setPRAutoMerge',
      'github.requestPRReviewers'
    ]) {
      expect(catalog, `${drawn} left the catalog`).toContain(drawn)
      expect(allowlist.has(drawn), `${drawn} left the mobile allowlist`).toBe(true)
    }
  })

  it('has no RPC that approves a pull request or asks for changes on one, so there is nothing for a button to call', () => {
    const verdicts = catalog.filter(submitsAVerdict)
    expect(
      verdicts,
      `Orca now catalogues ${verdicts.join(', ')}. Port the Claude PR detail's Approve and Request changes ` +
        `(sjj: "Approve", "Request changes", "What should change?", and the failures "Couldn't approve the pull ` +
        `request. You can try again." and "Couldn't request changes on the pull request. You can try again."), ` +
        `behind the host's mobile-scope answer, then delete this assertion.`
    ).toEqual([])
  })

  it('has Undraft only as an RPC the mobile-scope gate refuses on the recorded host', () => {
    expect(catalog).toContain(UNDRAFT_METHOD)
    expect(
      allowlist.has(UNDRAFT_METHOD),
      `The recorded allowlist now carries ${UNDRAFT_METHOD}: a phone can call it. Port Undraft ` +
        `(ccr_pr_mark_ready, failure "Couldn't mark the pull request ready for review. You can try again.") ` +
        `for a draft PR, and delete this assertion.`
    ).toBe(false)
  })

  it('names that method in no source file, so no control can send it without the host being asked first', () => {
    const offenders = ['app', 'src']
      .flatMap((directory) => censusSourceFiles(join(mobileRoot, directory)))
      .filter((path) => /\.(ts|tsx)$/.test(path) && !/\.test\.tsx?$/.test(path))
      .filter((path) => readFileSync(path, 'utf8').includes(UNDRAFT_METHOD))
      .map((path) => relative(mobileRoot, path))
    expect(
      offenders,
      `${UNDRAFT_METHOD} is refused to a phone on Orca 1.4.205. Sending it needs the capability probe first (see this file's header).`
    ).toEqual([])
  })

  it('draws no Undraft, Approve or Request changes button in the pull request sidebar', () => {
    const sidebar = [
      join(mobileRoot, 'src', 'components', 'MobilePRSidebar.tsx'),
      ...censusSourceFiles(join(mobileRoot, 'src', 'components', 'pr-sidebar')).filter(
        (path) => path.endsWith('.tsx') && !path.endsWith('.test.tsx')
      )
    ]
    const labels = /['"`>]\s*(Undraft|Approve|Request changes|Mark ready for review)\s*['"`<]/
    const offenders = sidebar
      .filter((path) => labels.test(readFileSync(path, 'utf8')))
      .map((path) => relative(mobileRoot, path))
    expect(offenders).toEqual([])
  })
})
