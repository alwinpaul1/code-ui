import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  HOST_MOBILE_CAPABILITY_KEYS,
  type HostMobileCapabilityKey
} from './host-mobile-capability-operations'

/**
 * Ratchet: every RPC method the phone can send is either on the host's
 * mobile-scope allowlist or behind a probe that asks the host first.
 *
 * Orca's WebSocket dispatch refuses any method not on a hardcoded allowlist
 * when the caller's device token has scope `mobile` — which the phone's
 * always does — with `{ code: 'forbidden', message: "Method '<m>' is not
 * available to mobile clients" }`, before dispatch. The RPC catalog
 * (`src/shared/rpc-contract/`) lists every method the desktop REGISTERS and
 * says nothing about this gate, so "catalogued" and "reachable from a phone"
 * are different sets, and tsc only checks the first. On 2026-09-18 two ports
 * and three editors shipped against `files.write` and `agentSession.rewind`,
 * both catalogued, neither reachable; every tap got the refusal.
 *
 * The allowlist as read from the installed 1.4.205 bundle is
 * `fixtures/orca-mobile-rpc-allowlist-1.4.205.json`. There is no RPC that
 * lists it; a newer Orca means re-reading the bundle's `iRa` Set and
 * committing a NEW fixture under the new version's name, then pointing this
 * test at it — a deliberate edit, never a silent drift.
 *
 * What is scanned: every string literal in a non-test file under `app/` and
 * `src/` that names a catalogued method. A wide net on purpose — the method
 * often sits in a ternary, a wrapper's argument or a `method:` field rather
 * than as `sendRequest`'s first argument, and the narrow net misses a fifth
 * of them (186 of 232 on 2026-09-18). A literal that is never sent is then an
 * explicit `never-sent` exception below, and that claim is itself checked
 * against the send positions, so it cannot rot into a loophole.
 *
 * What this does NOT catch, all accepted:
 *   - A method name built at runtime (`'git.' + verb`). Nothing in the tree
 *     does this today; the port boundary test's dynamic dispatchers all take
 *     the literal from a caller this scan does see.
 *   - Whether a method the list DOES carry is called with params the host
 *     accepts. That is the catalog's job.
 *   - A host older or newer than the fixture. The fixture is one version's
 *     truth and says so in its name.
 */

type AllowlistException =
  | {
      readonly method: string
      /** Hidden until host-mobile-capabilities.ts has seen the host let it through. */
      readonly guard: 'probe'
      readonly key: HostMobileCapabilityKey
      readonly why: string
    }
  | {
      readonly method: string
      /** A read whose refusal degrades to an empty state with nothing to tap.
       *  Its sender must recognise the gate's refusal (isMobileScopeRefusal)
       *  so it stops asking; a tappable affordance is never this kind. */
      readonly guard: 'fails-open'
      readonly why: string
    }
  | {
      readonly method: string
      /** The literal names the method without sending it (a params-shape set,
       *  say). Checked: it must not appear in any send position. */
      readonly guard: 'never-sent'
      readonly why: string
    }

const EXCEPTIONS: readonly AllowlistException[] = [
  {
    method: 'files.write',
    guard: 'probe',
    key: 'files.write',
    why: '"Revert this hunk" and the three project-config Save buttons; each surface reads useHostMobileCapability(hostId, "files.write") and shows nothing tappable until it is true.'
  },
  {
    method: 'agentSession.rewind',
    guard: 'probe',
    key: 'agentSession.rewind',
    why: '"Rewind to here" on the structured lane; MobileNativeChatOverlay ANDs hostAllowsRewind with the session\'s own rewindSupport.'
  },
  {
    method: 'skills.discover',
    guard: 'fails-open',
    why: 'The `/` menu\'s installed-skills read. A refusal leaves the list empty, which is what an old host already did; use-mobile-native-chat-skills.ts latches the gate\'s refusal so it is asked once per client, not every 3 s.'
  },
  {
    method: 'github.prComments',
    guard: 'never-sent',
    why: 'Named in github-pr-rpc.ts\'s METHODS_ACCEPTING_PR_REPO param-shape set only; no caller sends it.'
  }
]

const FIXTURE_FILE = 'orca-mobile-rpc-allowlist-1.4.205.json'
const FIXTURE_VERSION = '1.4.205'
const FIXTURE_METHOD_COUNT = 289

const mobileRoot = fileURLToPath(new URL('../..', import.meta.url))
const scannedRoots = ['app', 'src'].map((directory) => join(mobileRoot, directory))
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const catalogPath = join(mobileRoot, '..', 'src', 'shared', 'rpc-contract', 'rpc-params-catalog.generated.ts')
const fixturePath = join(mobileRoot, 'src', 'transport', 'fixtures', FIXTURE_FILE)

/** Nothing in it runs: every line is a tsc assertion. Its literals are not sends. */
const NEVER_RUNS = new Set(['src/transport/rpc-operation-compile-fence.ts'])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' ? [] : sourceFiles(path)
    }
    return [path]
  })
}

function parse(path: string, source: string): ts.SourceFile {
  const extension = extname(path)
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    extension === '.tsx' || extension === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
}

/** The keys of the generated `RPC_PARAMS_BY_METHOD` object literal, by AST — the host's registry. */
function readCatalogMethods(): Set<string> {
  const sourceFile = parse(catalogPath, readFileSync(catalogPath, 'utf8'))
  const methods = new Set<string>()
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
            methods.add(property.name.text)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return methods
}

/** Every catalogued method a file names, and which of those it names in a SEND position. */
export function catalogedMethodLiterals(
  path: string,
  source: string,
  catalog: ReadonlySet<string>
): { named: Set<string>; sent: Set<string>; readsMobileScopeRefusal: boolean } {
  const named = new Set<string>()
  const sent = new Set<string>()
  let importsRefusalReader = false
  let callsRefusalReader = false
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && catalog.has(node.text)) {
      named.add(node.text)
      const parent: ts.Node | undefined = node.parent
      // `client.sendRequest('m', …)`, `client.subscribe('m', …)`
      if (
        parent &&
        ts.isCallExpression(parent) &&
        parent.arguments[0] === node &&
        ts.isPropertyAccessExpression(parent.expression) &&
        (parent.expression.name.text === 'sendRequest' ||
          parent.expression.name.text === 'subscribe')
      ) {
        sent.add(node.text)
      }
      // `sendSingleFlightRequest(client, hostId, 'm')`
      if (
        parent &&
        ts.isCallExpression(parent) &&
        parent.arguments[2] === node &&
        ts.isIdentifier(parent.expression) &&
        parent.expression.text === 'sendSingleFlightRequest'
      ) {
        sent.add(node.text)
      }
      // `{ method: 'm' }` — an operation definition or a dispatcher's step.
      if (
        parent &&
        ts.isPropertyAssignment(parent) &&
        parent.initializer === node &&
        ts.isIdentifier(parent.name) &&
        parent.name.text === 'method'
      ) {
        sent.add(node.text)
      }
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.endsWith('/mobile-scope-refusal') &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some(
        (element) => element.name.text === 'isMobileScopeRefusal'
      )
    ) {
      importsRefusalReader = true
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'isMobileScopeRefusal'
    ) {
      callsRefusalReader = true
    }
    ts.forEachChild(node, visit)
  }
  visit(parse(path, source))
  return { named, sent, readsMobileScopeRefusal: importsRefusalReader && callsRefusalReader }
}

const catalog = readCatalogMethods()

const scanned = scannedRoots
  .flatMap(sourceFiles)
  .filter((path) => sourceExtensions.has(extname(path)))
  .filter((path) => !/\.test\.tsx?$/.test(path))
  .map((path) => relative(mobileRoot, path).split(/[/\\]/).join('/'))
  .filter((file) => !NEVER_RUNS.has(file))

const observed = new Map(
  scanned.map(
    (file) =>
      [
        file,
        catalogedMethodLiterals(join(mobileRoot, file), readFileSync(join(mobileRoot, file), 'utf8'), catalog)
      ] as const
  )
)

const namedByMethod = new Map<string, string[]>()
const sentByMethod = new Map<string, string[]>()
for (const [file, { named, sent }] of observed) {
  for (const method of named) {
    namedByMethod.set(method, [...(namedByMethod.get(method) ?? []), file])
  }
  for (const method of sent) {
    sentByMethod.set(method, [...(sentByMethod.get(method) ?? []), file])
  }
}

const fixture: { orcaVersion: string; readFrom: string; capturedOn: string; methods: string[] } =
  JSON.parse(readFileSync(fixturePath, 'utf8'))
const allowlist = new Set(fixture.methods)
const excepted = new Map(EXCEPTIONS.map((exception) => [exception.method, exception]))

describe('the recorded mobile-scope allowlist', () => {
  it('is the one its file name says, with every method once', () => {
    expect(fixture.orcaVersion).toBe(FIXTURE_VERSION)
    expect(FIXTURE_FILE).toContain(FIXTURE_VERSION)
    expect(fixture.readFrom).toMatch(/iRa/)
    expect(fixture.capturedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // A re-capture from a newer Orca is a new fixture under a new name, and
    // this number moves with it on purpose.
    expect(fixture.methods).toHaveLength(FIXTURE_METHOD_COUNT)
    expect(new Set(fixture.methods).size).toBe(FIXTURE_METHOD_COUNT)
    for (const method of fixture.methods) {
      expect(method).toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/)
    }
  })

  it('agrees with the catalog on spelling, except for what the vendored catalog is too old to know', () => {
    // The installed desktop is newer than the catalog this fork vendors: on
    // 2026-09-18 it allowed two aiVault search methods the catalog has no row
    // for. Nothing on the phone can send them (tsc would refuse the name), so
    // they are pinned here rather than hidden; re-vendoring the catalog past
    // them shrinks this list, and a typo in a re-captured fixture grows it.
    expect(fixture.methods.filter((method) => !catalog.has(method))).toEqual([
      'aiVault.searchSessions',
      'aiVault.searchStatus'
    ])
  })

  it('does not carry the two methods that were caught missing, or the ratchet would be vacuous', () => {
    expect(allowlist.has('files.write')).toBe(false)
    expect(allowlist.has('agentSession.rewind')).toBe(false)
  })
})

describe('every RPC method the phone can send', () => {
  const probe = join(mobileRoot, 'src', 'transport', 'probe.ts')
  const small = new Set(['worktree.ps', 'files.write', 'terminal.subscribe'])

  it('is found in each shape a send takes, and only when it names a catalogued method', () => {
    const read = (source: string) => catalogedMethodLiterals(probe, source, small)
    expect([...read("await client.sendRequest('worktree.ps', {})").sent]).toEqual(['worktree.ps'])
    expect([...read("client.subscribe('terminal.subscribe', {}, cb)").sent]).toEqual(['terminal.subscribe'])
    expect([...read("sendSingleFlightRequest(c, h, 'worktree.ps')").sent]).toEqual(['worktree.ps'])
    expect([...read("defineRpcOperation({ method: 'files.write' })").sent]).toEqual(['files.write'])
    // Named but not sent: a ternary, a wrapper's argument, a Set member.
    const ternary = read("const m = a ? 'worktree.ps' : 'files.write'")
    expect([...ternary.named].sort()).toEqual(['files.write', 'worktree.ps'])
    expect([...ternary.sent]).toEqual([])
    expect([...read("new Set(['files.write'])").sent]).toEqual([])
    // Prose never counts; an unknown dotted string never counts.
    expect([...read("// calls files.write under the hood").named]).toEqual([])
    expect([...read("await client.sendRequest('no.such', {})").named]).toEqual([])
    // The fails-open marker: the refusal reader must be imported AND called.
    expect(
      read("import { isMobileScopeRefusal } from '../transport/mobile-scope-refusal'\nif (isMobileScopeRefusal(r)) {}")
        .readsMobileScopeRefusal
    ).toBe(true)
    expect(
      read("import { isMobileScopeRefusal } from '../transport/mobile-scope-refusal'").readsMobileScopeRefusal
    ).toBe(false)
  })

  it('scans a plausible number of files and methods', () => {
    // A broken root, extension filter or catalog parse would make every check
    // below vacuously pass.
    expect(scanned.length).toBeGreaterThan(400)
    expect(catalog.size).toBeGreaterThan(500)
    expect(namedByMethod.size).toBeGreaterThan(150)
    expect(sentByMethod.size).toBeGreaterThan(100)
  })

  it('is on the host’s mobile allowlist, or is an explicit exception here', () => {
    const unreachable = [...namedByMethod.entries()]
      .filter(([method]) => !allowlist.has(method) && !excepted.has(method))
      .map(([method, files]) => `${method} (${files.join(', ')})`)
    expect(
      unreachable,
      `Catalogued is not reachable: Orca refuses these from a mobile-scope token ("Method '<m>' is not available to mobile clients"). Either the host allows it (re-read the bundle's iRa Set into a new fixtures/orca-mobile-rpc-allowlist-<version>.json) or gate the surface behind a probe in host-mobile-capabilities.ts and add an exception in ${relative(mobileRoot, import.meta.filename)}.`
    ).toEqual([])
  })

  it('lists each exception once, for a method the tree still names and the host still refuses', () => {
    const methods = EXCEPTIONS.map((exception) => exception.method)
    expect(methods.filter((method, index) => methods.indexOf(method) !== index)).toEqual([])
    const stale = EXCEPTIONS.filter((exception) => !namedByMethod.has(exception.method))
    expect(
      stale.map((exception) => exception.method),
      'Nothing names this method any more — delete its exception.'
    ).toEqual([])
    const nowAllowed = EXCEPTIONS.filter((exception) => allowlist.has(exception.method))
    expect(
      nowAllowed.map((exception) => exception.method),
      'The fixture now allows this method — delete its exception and its probe.'
    ).toEqual([])
  })

  it('guards each probe-gated exception with a probe that really sends that method', () => {
    const operations = observed.get('src/transport/host-mobile-capability-operations.ts')
    expect(operations).toBeDefined()
    for (const exception of EXCEPTIONS) {
      if (exception.guard !== 'probe') {
        continue
      }
      expect(HOST_MOBILE_CAPABILITY_KEYS).toContain(exception.key)
      expect(exception.key).toBe(exception.method)
      expect(
        [...operations!.sent],
        `${exception.method} claims a probe but host-mobile-capability-operations.ts defines no operation on it`
      ).toContain(exception.method)
    }
    // And every probe key has its exception: a key without one is a probe
    // nothing asks for.
    for (const key of HOST_MOBILE_CAPABILITY_KEYS) {
      expect(excepted.get(key)?.guard).toBe('probe')
    }
  })

  it('checks a never-sent exception against the send positions, so it cannot become a loophole', () => {
    for (const exception of EXCEPTIONS) {
      if (exception.guard !== 'never-sent') {
        continue
      }
      expect(
        sentByMethod.get(exception.method) ?? [],
        `${exception.method} is claimed never-sent but a send position names it — gate it or allow it.`
      ).toEqual([])
    }
  })

  it('requires a fails-open sender to read the gate’s refusal, so it stops asking', () => {
    for (const exception of EXCEPTIONS) {
      if (exception.guard !== 'fails-open') {
        continue
      }
      const senders = sentByMethod.get(exception.method) ?? []
      expect(senders, `${exception.method} is claimed fails-open but nothing sends it`).not.toEqual([])
      for (const file of senders) {
        expect(
          observed.get(file)?.readsMobileScopeRefusal,
          `${file} sends ${exception.method} without recognising the mobile-scope refusal (isMobileScopeRefusal from transport/mobile-scope-refusal.ts)`
        ).toBe(true)
      }
    }
  })
})
