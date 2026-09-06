import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'
import { MOBILE_SESSION_ROUTE_SOURCE_FILES } from './mobile-session-route-source-family.test-support'

const SESSION_FILES = MOBILE_SESSION_ROUTE_SOURCE_FILES
const LOGIC_EXPANSION_NAMES = new Set([
  'useMobileSessionController',
  'useMobileSessionFoundation',
  'useMobileSessionScreenState',
  'useMobileSessionTerminalRuntime',
  'useMobileSessionFeedbackCapabilities',
  'useMobileSessionNativeChatDictation',
  'useMobileSessionTerminalSubscriptionFoundation',
  'useMobileSessionTerminalSubscription',
  'useMobileSessionTerminalStreamDisplay',
  'useMobileSessionTerminalList',
  'useMobileSessionTabApplication',
  'useMobileSessionDocumentReaders',
  'useMobileSessionDiffComments',
  'useMobileSessionMarkdownActions',
  'useMobileSessionTabReconciliation',
  'useMobileSessionLifecycle',
  'useMobileSessionKeyboardState',
  'useMobileSessionStartup',
  'useMobileSessionPreferenceFocus',
  'useMobileSessionTabSwitching',
  'useMobileSessionTerminalWebview',
  'useMobileSessionTerminalSendActions',
  'useMobileSessionFileActions',
  'useMobileSessionTerminalInput',
  'useMobileSessionAccessorySelection',
  'useMobileSessionAttachments',
  'useMobileSessionTerminalCreateActions',
  'useMobileSessionContentCreateActions',
  'useMobileSessionCloseActions',
  'useMobileSessionBulkClose',
  'useMobileSessionPresentation',
  'useMobileSessionPanelRouteActions'
])
const SURFACE_EXPANSION_NAMES = new Set([
  'MobileSessionSurface',
  'MobileSessionHeader',
  'MobileSessionContentRow',
  'MobileSessionActiveContent',
  'MobileSessionCommandDock',
  'MobileSessionSheets'
])
const CONTENT_COMPONENT_NAMES = ['MarkdownReader', 'DiffLineRow', 'FileReader'] as const
const HOST_COMPONENT_NAMES = new Set([
  'ActivityIndicator',
  'Animated.View',
  'FlatList',
  'Image',
  'Pressable',
  'SafeAreaView',
  'ScrollView',
  'Text',
  'TextInput',
  'View'
])

// Pins re-baselined 2026-09-05 for the Code UI fork after the themed session
// chrome (header, dock, accessory strip, active content) landed. Values below
// are the current extraction facts; a future drift here is a real change.
const HEAD_MAIN_HOOK_SHA256 = 'ebfdb1f81c25f2ed54acaf75c503a826eea36ef16d3b271ae5d370ac47fe88a5'
const HEAD_HOOK_BINDING_SHA256 = '59e832f8814beb98a10d0748f559e64192834cdbb7fdc13f82c5497d6044830f'
const HEAD_CALLBACK_IDENTITY_SHA256 =
  '4eb795ff870f31ccce483e196993f15756c380c7bf223f6af0342131d587054e'
const HEAD_CALLBACK_BODY_SHA256 = 'aeab73f01a7625ca468aed9b0dce7d67f020caaeaf695cfa61864c3d834a4ada'
const HEAD_EFFECT_SHA256 = '1e323d7da17774bb1802be9171a84ec3263d1a9dbdd7df5ec5c854fb95a320c1'
const HEAD_CONTENT_HOOK_SHA256 = '9c3b612fef3f370d66873aefdbe1d701f20cb64ded31fef5cc45fde6f8189581'
// 2026-09-06: Codex server creation now reports unsupported hosts instead of
// falling back to a terminal (d3e102b); reviewed alongside image-paste ordering.
const HEAD_NESTED_FUNCTION_SHA256 =
  '72a366846cd56bd27e4a12cac7ba8f11fb24984e422b2c784184ae3ea5c186ce'
const HEAD_NATIVE_REGISTRATION_SHA256 =
  '8538d663d9e19168ac00c1b34035d7a54963c226609ea1e3546ecf78eab41b4c'
const HEAD_NATIVE_REMOVAL_SHA256 =
  '4c994574675a2a0f9c607b3ea89ab7a2ed5a83f7c72fa42342ddcb5f00fc3f4f'
const HEAD_TIMER_CREATION_SHA256 =
  '8b2229f4a3c880c0e21f546a1bfabb27b3536b9a2344cf3b39f5b7da82e24dba'
const HEAD_TIMER_CLEANUP_SHA256 = 'be3117bde057916619602341bef132f1bd8767d1dff4bacdfd547ca690f5640a'
const HEAD_RUNTIME_STRING_SHA256 =
  '6111d2e1385ccc700ec20ba7683ef035c57af6bb91799118911d888def073d7d'
const HEAD_HOST_JSX_SHA256 = '1e54bb23081f72ebe765526bb90d22643705e0e9884817e8ccb519af8e5ffe97'
// 2026-09-06: queue editor controls added to the terminal dock.
const HEAD_LEAF_JSX_SHA256 = '648f46d97d268404e64941b1b11994a21b6bd4dc147253f21984a64f86863586'
const HEAD_STYLE_REFERENCE_SHA256 =
  'dc3045316785412e2e97a73a867ea70a4fdb0a00b3f7a43a7bb0a0da8b03ac62'
const HEAD_IDENTITY_FIELD_SHA256 =
  '91146853930a34dd1f3d80e5c97fbacd7cf19fb93dd26fe8fc6f29169622f9d6'
const HEAD_NAVIGATION_SHA256 = '9d96f5dad7de555d6553eac39c0fab00efad507470fd562cb9beaa32db16f512'
const HEAD_CAPABILITY_SHA256 = '7703776b3776ee1f3a7968cae26fa6741b747665c9070bd89bb62f69dd704af4'

type Definition = { declaration: ts.FunctionDeclaration; sourceFile: ts.SourceFile }
type HookFacts = {
  bindings: string[]
  callbackBodies: string[]
  callbacks: string[]
  effects: string[]
  hooks: string[]
}

const printer = ts.createPrinter({ removeComments: true })
const sourceFiles = new Map<string, ts.SourceFile>()

function parse(relativePath: string): ts.SourceFile {
  const cached = sourceFiles.get(relativePath)
  if (cached) {
    return cached
  }
  const filePath = fileURLToPath(new URL(relativePath, import.meta.url))
  const sourceFile = ts.createSourceFile(
    relativePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  sourceFiles.set(relativePath, sourceFile)
  return sourceFile
}

function canonical(node: ts.Node, sourceFile: ts.SourceFile): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, sourceFile).replace(/\s+/g, '')
}

function hash(values: readonly string[]): string {
  return createHash('sha256').update(values.join('\n')).digest('hex')
}

function readDefinitions(): Map<string, Definition> {
  const definitions = new Map<string, Definition>()
  for (const relativePath of SESSION_FILES) {
    const sourceFile = parse(relativePath)
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        definitions.set(node.name.text, { declaration: node, sourceFile })
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return definitions
}

function visitLogicalFunction(
  name: string,
  definitions: ReadonlyMap<string, Definition>,
  onNode: (node: ts.Node, sourceFile: ts.SourceFile) => void,
  active = new Set<string>()
): void {
  const definition = definitions.get(name)
  if (!definition?.declaration.body) {
    throw new Error(`Missing session function: ${name}`)
  }
  if (active.has(name)) {
    throw new Error(`Recursive session function: ${name}`)
  }
  const nextActive = new Set(active).add(name)
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      LOGIC_EXPANSION_NAMES.has(node.expression.text)
    ) {
      visitLogicalFunction(node.expression.text, definitions, onNode, nextActive)
      return
    }
    onNode(node, definition.sourceFile)
    ts.forEachChild(node, visit)
  }
  visit(definition.declaration.body)
}

function readHookFacts(name: string, definitions: ReadonlyMap<string, Definition>): HookFacts {
  const facts: HookFacts = {
    bindings: [],
    callbackBodies: [],
    callbacks: [],
    effects: [],
    hooks: []
  }
  visitLogicalFunction(name, definitions, (node, sourceFile) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      !/^use[A-Z]/.test(node.expression.text)
    ) {
      return
    }
    const hookName = node.expression.text
    facts.hooks.push(hookName)
    const owner = ts.isVariableDeclaration(node.parent)
      ? node.parent.name.getText(sourceFile)
      : ts.isExpressionStatement(node.parent)
        ? '<statement>'
        : ts.isCallExpression(node.parent) && ts.isIdentifier(node.parent.expression)
          ? `<argument:${node.parent.expression.text}>`
          : '<nested>'
    const lastArgument = node.arguments.at(-1)
    const dependencies =
      lastArgument && ts.isArrayLiteralExpression(lastArgument)
        ? canonical(lastArgument, sourceFile)
        : '<none>'
    facts.bindings.push(`${hookName}|${owner}|${dependencies}`)
    if (hookName === 'useCallback') {
      facts.callbacks.push(`${owner}|${dependencies}`)
      facts.callbackBodies.push(
        `${owner}|${canonical(node.arguments[0], sourceFile)}|${dependencies}`
      )
    }
    if (hookName === 'useEffect') {
      facts.effects.push(`${canonical(node.arguments[0], sourceFile)}|${dependencies}`)
    }
  })
  return facts
}

function readNestedFunctions(definitions: ReadonlyMap<string, Definition>): string[] {
  const functions: string[] = []
  const visitDefinition = (name: string, active: ReadonlySet<string>): void => {
    const definition = definitions.get(name)
    if (!definition?.declaration.body || active.has(name)) {
      throw new Error(`Invalid nested-function stage: ${name}`)
    }
    const nextActive = new Set(active).add(name)
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        LOGIC_EXPANSION_NAMES.has(node.expression.text)
      ) {
        visitDefinition(node.expression.text, nextActive)
        return
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        functions.push(`${node.name.text}|${canonical(node, definition.sourceFile)}`)
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(definition.declaration.body)
  }
  visitDefinition('SessionScreen', new Set())
  return functions
}

function readNativeAndTimerFacts(definitions: ReadonlyMap<string, Definition>): {
  cleanups: string[]
  creations: string[]
  registrations: string[]
  removals: string[]
} {
  const registrations: string[] = []
  const removals: string[] = []
  const creations: string[] = []
  const cleanups: string[] = []
  const collect = (node: ts.Node, sourceFile: ts.SourceFile): void => {
    if (!ts.isCallExpression(node)) {
      return
    }
    if (ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression.getText(sourceFile)
      const method = node.expression.name.text
      if (
        ['BackHandler', 'AppState', 'Keyboard'].includes(receiver) &&
        ['addEventListener', 'addListener'].includes(method)
      ) {
        registrations.push(canonical(node, sourceFile))
      }
      if (method === 'remove') {
        removals.push(canonical(node, sourceFile))
      }
    }
    if (ts.isIdentifier(node.expression)) {
      if (['setTimeout', 'setInterval', 'requestAnimationFrame'].includes(node.expression.text)) {
        creations.push(canonical(node, sourceFile))
      }
      if (
        ['clearTimeout', 'clearInterval', 'cancelAnimationFrame'].includes(node.expression.text)
      ) {
        cleanups.push(canonical(node, sourceFile))
      }
    }
  }
  visitLogicalFunction('FileReader', definitions, collect)
  visitLogicalFunction('SessionScreen', definitions, collect)
  return { cleanups, creations, registrations, removals }
}

function isRuntimeNode(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isImportDeclaration(parent) ||
      ts.isExportDeclaration(parent) ||
      ts.isImportTypeNode(parent) ||
      ts.isTypeNode(parent)
    ) {
      return false
    }
  }
  return true
}

function readRuntimeStrings(): string[] {
  const values: string[] = []
  for (const relativePath of SESSION_FILES) {
    const visit = (node: ts.Node): void => {
      if (isRuntimeNode(node)) {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)
        ) {
          values.push(node.text)
        }
        if (ts.isJsxText(node) && node.text.trim()) {
          values.push(node.text.replace(/\s+/g, ' ').trim())
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(parse(relativePath))
  }
  return values.sort()
}

function readJsxFacts(definitions: ReadonlyMap<string, Definition>): {
  host: string[]
  leaf: string[]
  styleReferences: string[]
} {
  const host: string[] = []
  const leaf: string[] = []
  const active = new Set<string>()
  const visitDefinition = (name: string): void => {
    const definition = definitions.get(name)
    if (!definition?.declaration.body || active.has(name)) {
      throw new Error(`Invalid JSX stage: ${name}`)
    }
    active.add(name)
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        LOGIC_EXPANSION_NAMES.has(node.expression.text)
      ) {
        visitDefinition(node.expression.text)
        return
      }
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node
        const tagName = opening.tagName.getText(definition.sourceFile)
        if (SURFACE_EXPANSION_NAMES.has(tagName)) {
          visitDefinition(tagName)
          return
        }
        const attributes = opening.attributes.properties
          .map((attribute) => {
            if (ts.isJsxSpreadAttribute(attribute)) {
              return `...${canonical(attribute.expression, definition.sourceFile)}`
            }
            const attributeName = attribute.name.getText(definition.sourceFile)
            if (!attribute.initializer) {
              return attributeName
            }
            if (ts.isStringLiteral(attribute.initializer)) {
              return `${attributeName}=${JSON.stringify(attribute.initializer.text)}`
            }
            return `${attributeName}=${
              attribute.initializer.expression
                ? canonical(attribute.initializer.expression, definition.sourceFile)
                : ''
            }`
          })
          .join(',')
        ;(HOST_COMPONENT_NAMES.has(tagName) ? host : leaf).push(`${tagName}|${attributes}`)
        for (const attribute of opening.attributes.properties) {
          ts.forEachChild(attribute, visit)
        }
        if (ts.isJsxElement(node)) {
          for (const child of node.children) {
            visit(child)
          }
        }
        return
      }
      if (ts.isJsxFragment(node)) {
        for (const child of node.children) {
          visit(child)
        }
        return
      }
      ts.forEachChild(node, visit)
    }
    visit(definition.declaration.body)
    active.delete(name)
  }
  for (const name of CONTENT_COMPONENT_NAMES) {
    visitDefinition(name)
  }
  visitDefinition('SessionScreen')
  const styleReferences: string[] = []
  for (const record of [...host, ...leaf]) {
    for (const match of record.matchAll(/styles\.([A-Za-z0-9_]+)/g)) {
      styleReferences.push(match[1])
    }
  }
  return { host, leaf, styleReferences }
}

function readCompatibilityFacts(definitions: ReadonlyMap<string, Definition>): {
  capabilities: string[]
  identityFields: string[]
  navigation: string[]
} {
  const capabilities: string[] = []
  const identityFields: string[] = []
  const navigation: string[] = []
  visitLogicalFunction('SessionScreen', definitions, (node, sourceFile) => {
    if (!isRuntimeNode(node)) {
      return
    }
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sourceFile)
      if (['notifyClients', 'deviceToken', 'clientId'].includes(name)) {
        identityFields.push(`${name}|${canonical(node.initializer, sourceFile)}`)
      }
      if (
        name === 'client' &&
        ts.isObjectLiteralExpression(node.initializer) &&
        node.initializer.properties.some(
          (property) => property.name?.getText(sourceFile) === 'id'
        ) &&
        node.initializer.properties.some(
          (property) => property.name?.getText(sourceFile) === 'type'
        )
      ) {
        identityFields.push(`client|${canonical(node.initializer, sourceFile)}`)
      }
    }
    if (!ts.isCallExpression(node)) {
      return
    }
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === 'router' &&
      ['push', 'replace', 'back'].includes(node.expression.name.text)
    ) {
      navigation.push(canonical(node, sourceFile))
    }
    const callName = ts.isIdentifier(node.expression)
      ? node.expression.text
      : ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ''
    const callText = canonical(node, sourceFile)
    if (
      ['startRuntimeCapabilityProbe', 'supportsMobileQuickCommands'].includes(callName) ||
      (callName === 'includes' && callText.includes('capabilities.includes'))
    ) {
      capabilities.push(callText)
    }
  })
  return { capabilities, identityFields, navigation }
}

describe('mobile session route extraction parity', () => {
  it('preserves hooks, callbacks, effects, and nested action bodies', () => {
    const definitions = readDefinitions()
    const main = readHookFacts('SessionScreen', definitions)
    const contentBindings = CONTENT_COMPONENT_NAMES.flatMap(
      (name) => readHookFacts(name, definitions).bindings
    )
    expect(main.hooks).toHaveLength(277)
    expect(hash(main.hooks)).toBe(HEAD_MAIN_HOOK_SHA256)
    expect(hash(main.bindings)).toBe(HEAD_HOOK_BINDING_SHA256)
    expect(main.callbacks).toHaveLength(79)
    expect(hash(main.callbacks)).toBe(HEAD_CALLBACK_IDENTITY_SHA256)
    expect(hash(main.callbackBodies)).toBe(HEAD_CALLBACK_BODY_SHA256)
    expect(main.effects).toHaveLength(24)
    expect(hash(main.effects)).toBe(HEAD_EFFECT_SHA256)
    expect(contentBindings).toHaveLength(14)
    expect(hash(contentBindings)).toBe(HEAD_CONTENT_HOOK_SHA256)
    const nestedFunctions = readNestedFunctions(definitions)
    expect(nestedFunctions).toHaveLength(12)
    expect(hash(nestedFunctions)).toBe(HEAD_NESTED_FUNCTION_SHA256)
  })

  it('preserves native listeners, timers, identity payloads, and compatibility gates', () => {
    const definitions = readDefinitions()
    const native = readNativeAndTimerFacts(definitions)
    expect(native.registrations).toHaveLength(7)
    expect(hash(native.registrations)).toBe(HEAD_NATIVE_REGISTRATION_SHA256)
    expect(native.removals).toHaveLength(9)
    expect(hash(native.removals)).toBe(HEAD_NATIVE_REMOVAL_SHA256)
    expect(native.creations.filter((fact) => fact.startsWith('setTimeout'))).toHaveLength(8)
    expect(native.creations.filter((fact) => fact.startsWith('setInterval'))).toHaveLength(1)
    expect(
      native.creations.filter((fact) => fact.startsWith('requestAnimationFrame'))
    ).toHaveLength(1)
    expect(hash(native.creations)).toBe(HEAD_TIMER_CREATION_SHA256)
    expect(native.cleanups.filter((fact) => fact.startsWith('clearTimeout'))).toHaveLength(13)
    expect(native.cleanups.filter((fact) => fact.startsWith('clearInterval'))).toHaveLength(1)
    expect(native.cleanups.filter((fact) => fact.startsWith('cancelAnimationFrame'))).toHaveLength(
      1
    )
    expect(hash(native.cleanups)).toBe(HEAD_TIMER_CLEANUP_SHA256)
    const compatibility = readCompatibilityFacts(definitions)
    expect(compatibility.identityFields).toHaveLength(14)
    expect(hash(compatibility.identityFields)).toBe(HEAD_IDENTITY_FIELD_SHA256)
    expect(compatibility.navigation).toHaveLength(6)
    expect(hash(compatibility.navigation)).toBe(HEAD_NAVIGATION_SHA256)
    expect(compatibility.capabilities).toHaveLength(5)
    expect(hash(compatibility.capabilities)).toBe(HEAD_CAPABILITY_SHA256)
  })

  it('preserves runtime strings, styles, and the expanded JSX tree', () => {
    const strings = readRuntimeStrings()
    expect(strings).toHaveLength(618)
    expect(hash(strings)).toBe(HEAD_RUNTIME_STRING_SHA256)
    const jsx = readJsxFacts(readDefinitions())
    expect(jsx.host).toHaveLength(95)
    expect(hash(jsx.host)).toBe(HEAD_HOST_JSX_SHA256)
    expect(jsx.leaf).toHaveLength(68)
    expect(hash(jsx.leaf)).toBe(HEAD_LEAF_JSX_SHA256)
    expect(jsx.styleReferences).toHaveLength(88)
    expect(hash(jsx.styleReferences)).toBe(HEAD_STYLE_REFERENCE_SHA256)
  })
})
