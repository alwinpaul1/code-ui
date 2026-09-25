import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// 2026-09-26, the user's phone: Code UI closed itself three times in two
// minutes. Every time: "[Worklets] Tried to synchronously call a Remote
// Function. Called "anonymous" on the UI Runtime", at
// settle_DraggableDetailSheetTsx3, which is the tool detail sheet's drag release.
// `settle` runs on the UI thread and called resolveDraggableSheetSnap, a plain
// function from another module. Reanimated refuses that and takes the app
// down. The unit tests mock Reanimated, so nothing ran either function on a UI
// runtime and the suite stayed green. The defect is structural (which function
// runs where), so this reads the source: a function called from UI-thread code
// must itself be a worklet, or be handed to runOnJS.

const SRC = resolve(import.meta.dirname, '..')

/** Gesture-handler callbacks Reanimated runs on the UI thread. */
const GESTURE_CALLBACKS = new Set([
  'onBegin',
  'onStart',
  'onUpdate',
  'onChange',
  'onEnd',
  'onFinalize',
  'onTouchesDown',
  'onTouchesMove',
  'onTouchesUp',
  'onTouchesCancelled'
])
/** Reanimated hooks whose first argument runs on the UI thread. */
const UI_THREAD_HOOKS = new Set([
  'useAnimatedStyle',
  'useAnimatedProps',
  'useAnimatedScrollHandler',
  'useDerivedValue',
  'useAnimatedReaction',
  'useFrameCallback'
])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === 'node_modules' ? [] : sourceFiles(path)
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [path] : []
  })
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
}

type FunctionLike = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
}

/** The `'worklet'` directive, as the first statement of the body. */
function hasWorkletDirective(fn: FunctionLike): boolean {
  const body = fn.body
  if (!body || !ts.isBlock(body)) {
    return false
  }
  const first = body.statements[0]
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'worklet'
  )
}

/** Whether a function literal is handed to something that runs it on the UI
 *  thread: a gesture callback on a `Gesture.*()` chain, or a Reanimated hook. */
function runsOnUiThreadByPlacement(fn: FunctionLike): boolean {
  const call = fn.parent
  if (!call || !ts.isCallExpression(call) || call.arguments[0] !== fn) {
    return false
  }
  const callee = call.expression
  if (ts.isIdentifier(callee)) {
    return UI_THREAD_HOOKS.has(callee.text)
  }
  if (ts.isPropertyAccessExpression(callee) && GESTURE_CALLBACKS.has(callee.name.text)) {
    // A chain configured with `.runOnJS(true)` runs every callback on the JS
    // thread, wherever in the chain that call sits (the chat's pinch-to-zoom).
    const chain = wholeChain(call).getText()
    return chain.includes('Gesture.') && !/\.runOnJS\(\s*true\s*\)/.test(chain)
  }
  return false
}

/** The outermost call of a builder chain, e.g. `Gesture.Pan().onEnd(f).runOnJS(true)`. */
function wholeChain(node: ts.Node): ts.Node {
  let top = node
  while (
    top.parent &&
    ((ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) ||
      (ts.isCallExpression(top.parent) && top.parent.expression === top))
  ) {
    top = top.parent
  }
  return top
}

/** Named functions a file declares (`function f` or `const f = () =>`), by name. */
function declaredFunctions(file: ts.SourceFile): Map<string, FunctionLike> {
  const byName = new Map<string, FunctionLike>()
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      byName.set(node.name.text, node)
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isFunctionLike(node.initializer)) {
      byName.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return byName
}

/** Relative imports: local name → the module file that declares it. */
function relativeImports(file: ts.SourceFile): Map<string, { path: string; imported: string }> {
  const byLocal = new Map<string, { path: string; imported: string }>()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }
    const spec = statement.moduleSpecifier.text
    if (!spec.startsWith('.')) {
      continue
    }
    const base = resolve(dirname(file.fileName), spec)
    const path = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((candidate) => existsSync(candidate))
    const named = statement.importClause?.namedBindings
    if (!path || !named || !ts.isNamedImports(named)) {
      continue
    }
    for (const element of named.elements) {
      if (!element.isTypeOnly) {
        byLocal.set(element.name.text, { path, imported: (element.propertyName ?? element.name).text })
      }
    }
  }
  return byLocal
}

/** Every call in UI-thread code whose callee is a function this repo declares
 *  that is not a worklet, as `file: callee`. */
function remoteCallsFromUiThread(): string[] {
  const offences: string[] = []
  const parsed = new Map<string, ts.SourceFile>()
  const load = (path: string): ts.SourceFile => parsed.get(path) ?? parsed.set(path, parse(path)).get(path)!
  for (const path of sourceFiles(SRC)) {
    const file = load(path)
    const local = declaredFunctions(file)
    const imports = relativeImports(file)
    const inspectBody = (fn: FunctionLike): void => {
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const name = node.expression.text
          const target =
            local.get(name) ??
            (() => {
              const source = imports.get(name)
              return source ? declaredFunctions(load(source.path)).get(source.imported) : undefined
            })()
          if (target && !hasWorkletDirective(target) && !runsOnUiThreadByPlacement(target)) {
            offences.push(`${relative(SRC, path)}: ${name}()`)
          }
        }
        ts.forEachChild(node, visit)
      }
      if (fn.body) {
        visit(fn.body)
      }
    }
    const walk = (node: ts.Node): void => {
      if (isFunctionLike(node) && (hasWorkletDirective(node) || runsOnUiThreadByPlacement(node))) {
        inspectBody(node)
      }
      ts.forEachChild(node, walk)
    }
    walk(file)
  }
  return [...new Set(offences)].sort()
}

describe('code that runs on the UI thread calls only worklets', () => {
  it('lets the tool detail sheet settle a drag without calling a plain function from the UI thread', () => {
    const sheet = remoteCallsFromUiThread().filter((offence) => offence.startsWith('components/DraggableDetailSheet'))
    expect(sheet).toEqual([])
  })

  it('finds no plain function called from a gesture callback, an animated hook or a worklet anywhere', () => {
    expect(remoteCallsFromUiThread()).toEqual([])
  })

  it('leaves a gesture that runs its callbacks on the JS thread alone', () => {
    const file = ts.createSourceFile(
      'probe.tsx',
      'const g = Gesture.Pinch().runOnJS(true).onUpdate((e) => { plain(e) })\nconst h = Gesture.Pan().onEnd((e) => { plain(e) })',
      ts.ScriptTarget.Latest,
      true
    )
    const callbacks: FunctionLike[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isArrowFunction(node)) {
        callbacks.push(node)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
    expect(callbacks.map(runsOnUiThreadByPlacement)).toEqual([false, true])
  })

  it('still sees the crash it was written for, so a clean result means something', () => {
    const file = ts.createSourceFile(
      'probe.tsx',
      "function snap(){ return 1 }\nfunction settle(){ 'worklet'\n snap() }",
      ts.ScriptTarget.Latest,
      true
    )
    const settle = declaredFunctions(file).get('settle')!
    const snap = declaredFunctions(file).get('snap')!
    expect(hasWorkletDirective(settle)).toBe(true)
    expect(hasWorkletDirective(snap)).toBe(false)
  })
})
