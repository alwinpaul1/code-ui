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
// 278 since 2026-09-18: use-mobile-session-file-actions.ts (inlined into
// SessionScreen's expansion) gained askAboutFileLines, a new useCallback for
// the file reader's "Ask about lines"/"Ask about file".
const HEAD_MAIN_HOOK_SHA256 = 'd78064216d8b5c1580b23db52c06c5a6c43a8778212ce5f46b9c1c1fe279cb68'
const HEAD_HOOK_BINDING_SHA256 = '138e4f51e8685a3f402bd1d4c3e648f07c3369e2aa546f3042497276f801f516'
// 79 since 2026-09-18: askAboutFileLines, same change as HEAD_MAIN_HOOK_SHA256 above.
const HEAD_CALLBACK_IDENTITY_SHA256 =
  'e9b3dbfcbd5758e543f04f4ecad7a6d36680537cc409d1a533e27021db9230d1'
// 2026-09-09: the terminal subscription strips the agents' HUD beacon out of
// each output chunk before anything else looks at it, and the create action
// asks for the launch flags that make the agents send one.
// 2026-09-10: split-sibling Close repeats terminal.close so the leftover
// desktop pane collapses after the extra PTY dies.
// 2026-09-11: wheel batches pipeline up to TERMINAL_GESTURE_INPUT_MAX_IN_FLIGHT
// unanswered sends instead of pacing one per relay round trip.
// 2026-09-11 (later): a burst of wheel rows is paced out one per 16 ms flush
// instead of sent as one batch, and nothing is dropped past a token bucket.
// 2026-09-11 (later still): each terminal pill carries an activity badge from
// the host's pushed status — a dot while the turn runs, a shell count after.
// 2026-09-11 (evening): the pill badge became the desktop's own state icons
// (AgentStateDot), on a minute clock for the 30-min staleness decay.
// 2026-09-11 (council fixes): the gesture token bucket is gone, a tap's click
// is sent at once instead of paced, and the ghostty pane routes taps to file/URL.
// 2026-09-11: hardware back moved from the markdown actions to the view switch,
// where it can return a terminal-mode tab to its chat view before leaving.
// 2026-09-18: askAboutFileLines's own body, same change as above.
const HEAD_CALLBACK_BODY_SHA256 = 'eaf64fb1ff48caf3601e14a33c29626792a808c21885d0f83d75451d23accb7f'
const HEAD_EFFECT_SHA256 = '1961e639d17f15cf6b60eb4e7616633184c5aa8477c2ce2aa6f23292c8f9e47c'
// 21 since 2026-09-18: FileReader's line-selection mode ("Ask about lines",
// Alt+K parity) adds useTheme's colors binding, the lineSelection state pair,
// the relativePath-keyed reset effect, and the range/highlight-style memos —
// four new bindings on top of the prior 17.
const HEAD_CONTENT_HOOK_SHA256 = 'f31fa6a1723e25916c1fb01a88c4252ef63f607501f0963ac904e75d04b614ce'
// 2026-09-06: Codex server creation now reports unsupported hosts instead of
// falling back to a terminal (d3e102b); reviewed alongside image-paste ordering.
// 2026-09-09: handleCreateTerminal resolves the HUD beacon launch config first.
// 2026-09-10: a bare launch gates on isAgentSessionHandleProvider instead of the
// 'codex' literal, so Claude opens a structured chat too. Claude still falls
// through to the terminal (and its HUD beacon) when the host cannot open one,
// Codex still refuses, and the refusal copy names the agent instead of always
// saying "Codex". Ablated against the pre-change tree: the whole suite passed
// with every other file of this port in place, so create-actions is the sole
// cause of both moved pins.
// 2026-09-10: visible terminals request phone cols even when Chat UI is off.
// 2026-09-10: a tab close now plans against the current strip, so a lone leaf
// closes through session.tabs.close instead of being addressed as a split.
// Moved by one line in handleCloseSessionTab (planSessionTabClose gains the
// sibling argument); no other nested body changed.
// 2026-09-10: the split-leaf close stopped repeating — the repeat loop in
// handleCloseSessionTab became a single await, because a second terminal.close
// on the dead handle made the host close the whole tab. Same one function.
// 2026-09-18: handleForkClaudeSession joins handleClearTerminal inside
// useMobileSessionTerminalInput — the session menu's Fork action types
// Claude's own `/fork` command and submits it.
const HEAD_NESTED_FUNCTION_SHA256 =
  '48b0504dc330d10f4c8b38bf164f24e620df21cebdcf8dc8a4ebd68fc592eb19'
const HEAD_NATIVE_REGISTRATION_SHA256 =
  'fd43c86a7fb3d12093d24ec695885173488485a29bb587b6facf93ed8af0667e'
const HEAD_NATIVE_REMOVAL_SHA256 =
  'df722f65c9d8a0904786a1d855c80475d85be0d772d9fe6b732e457485e00e9b'
const HEAD_TIMER_CREATION_SHA256 =
  'a3e52dbf52ebdf78037883906bc29959c52765b59baff9e3b6ee370ca1867c3f'
const HEAD_TIMER_CLEANUP_SHA256 = '1fe4ac8e695b6da1f471d7546d79ee62a27b9a582eb1eaa0f9e1f00ee36a7fa0'
// 656 since 2026-09-18: askAboutFileLines's "No chat is open to ask about
// this file" refusal toast, plus the 'terminal' literal in its
// plan.targetTab.type check (only a 'terminal' tab's chat view can be toggled;
// an 'agent-session' tab's is always on).
// 658 since 2026-09-18 (later): handleForkClaudeSession's two toast strings
// ("Forking from the latest message" / "Couldn't fork the session"). Its
// action-sheet label and hint live in mobile-terminal-action-sheet-actions.ts,
// outside this family, so they don't move this pin.
// 673 since 2026-09-18 (newest): the three new session-menu entries in
// MobileSessionHeaderMoreActionsSheet.tsx — "MCP Servers", "Permission
// Rules" and "Project Memory" — each with a hint string naming its file and
// "project scope only".
const HEAD_RUNTIME_STRING_SHA256 =
  'f70f5c25817cbec718014844326b5ba889f99595a59f7288a68cbaabf44582d3'
// 2026-09-17 (0.6.7): tap targets. Five session-route FILES, six sites (the key
// strip has two Pressables), drawn at 40 dp or less: the header's 32 dp tabs,
// the dock's 36 dp button, the key strip's 30 dp keys, the ask sheet's 30 dp
// QUESTION TAB STRIP, and the background-tasks sheet's 40 dp "load more". They
// gained `hitSlop={tapTargetHitSlop(…)}`.
// (Said "the ask sheet's options"; a review caught it. OptionRow is
// padding-sized, so the audit never saw it and it got nothing. Check with
// `grep -c hitSlop src/session/MobileNativeChatAsk.tsx`, which is 1.) That is one more
// attribute on host records at the same count (99); strings, leaf and style
// references are untouched and still match their earlier pins.
// 2026-09-17 (0.6.7, later): the .md reader paints its own page from the live
// theme. Its root and its two state views gained a themed `surface` entry in
// their style arrays and the read error a themed `error` entry: host records
// at the same count (99), everything else unchanged.
// 2026-09-18: FileReader's line-selection mode wires selectable/highlighted/
// highlightStyle/onLongPress/onPress onto the existing MobileSyntaxLine call
// inside its FlatList renderItem and adds a sibling conditional (the action
// bar) beside the FlatList — host record COUNT stays 99 (MobileSyntaxLine and
// the new MobileSessionFileReaderLineActionBar are custom components, not
// HOST_COMPONENT_NAMES), but the FlatList/View records' captured shape moved.
const HEAD_HOST_JSX_SHA256 = '12922f5e94e0aedb1bec67746bb8510ad4919ef7facfe2da7fe05087147871e2'
// 2026-09-06: queue editor controls added to the terminal dock.
// 2026-09-09 (night): the PDF viewer in the session file tab gets its file name
// for the Download button.
// 2026-09-15 (later): the markdown file tab reaches upstream Orca's own
// MobileFileMarkdownPreview instead of this fork's hand-rolled one, and hands it
// the path and the host's truncation facts alongside the source view it already
// lent. Exactly one leaf record changed — verified by extracting the reader's
// JSX records before and after; host and style-reference records are untouched,
// which is why only this pin moved.
// 2026-09-18: the line-selection action bar is one new leaf record (the
// FileReader-level <MobileSessionFileReaderLineActionBar> call); style
// references are untouched — its own styling is inline, in its own file.
// 2026-09-18 (later): MobileSessionActiveContent's <FileReader> call gained
// the onAskAboutLines prop — same leaf COUNT (72), the existing record's
// captured shape moved.
// 2026-09-18 (later still): the subagent transcript viewer.
// MobileSessionActiveContent mounts one <MobileSubagentTranscriptModal hostId
// worktreeId/> beside the chat overlay — one new leaf record (72 → 73);
// strings, host and style-reference records are untouched.
// 2026-09-18 (same day): MobileSessionSheets' terminal ActionSheetModal gained
// one more getMobileTerminalActionSheetActions() argument (`onFork`), which
// lengthens that one leaf record's canonicalized `actions=` attribute text —
// same 73 records, one of them different — since the record is the whole
// attribute expression, not a per-argument entry.
// 2026-09-18 (newest), same shape again: MobileSessionHeaderMoreActionsSheet's
// <ActionSheetModal actions={[…]} /> is the one leaf record that moved — its
// `actions=` array literal gained the three new project-config entries (MCP
// Servers / Permission Rules / Project Memory). Still 73 records.
const HEAD_LEAF_JSX_SHA256 = '6ccb4a02eb0ca29c37d4d9a38a0eba12df4e985ce8959d01f8397b10f873c3a0'
const HEAD_STYLE_REFERENCE_SHA256 =
  '9cca82fa17ffc5585c6953662cd2f271021ec6fe22641eb85bc5af2ee3a9a45a'
// 2026-09-18: handleForkClaudeSession's own `deviceToken: deviceTokenRef.current`
// read joins the same-shaped reads terminal.send already made elsewhere in the
// family — one more occurrence of an existing identity-field pattern, not a
// new one.
const HEAD_IDENTITY_FIELD_SHA256 =
  '93970ef0061d184c87ea4ae96f7017d7477235f2fb0a686534d84ff7bb0e7d74'
// 9 since 2026-09-18 (newest): useMobileSessionPanelRouteActions gained
// openMcpServers/openPermissionRules/openProjectMemory — three router.push
// navigators for the new project-config screens (MCP servers, permission
// rules, project memory), each session-menu entries alongside Agent History.
const HEAD_NAVIGATION_SHA256 = '3a02dc91d91dffc6fe7f20a88a03f6a1f131badc4a85b4b16bbd2234f3079f96'
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
    // 277 since 2026-09-15: the session tabs re-read a document when the host
    // reconnects — useLocalSearchParams, useLastConnectedAt and the ledger ref.
    expect(main.hooks).toHaveLength(278)
    expect(hash(main.hooks)).toBe(HEAD_MAIN_HOOK_SHA256)
    expect(hash(main.bindings)).toBe(HEAD_HOOK_BINDING_SHA256)
    expect(main.callbacks).toHaveLength(79)
    expect(hash(main.callbacks)).toBe(HEAD_CALLBACK_IDENTITY_SHA256)
    expect(hash(main.callbackBodies)).toBe(HEAD_CALLBACK_BODY_SHA256)
    expect(main.effects).toHaveLength(23)
    expect(hash(main.effects)).toBe(HEAD_EFFECT_SHA256)
    expect(contentBindings).toHaveLength(21)
    expect(hash(contentBindings)).toBe(HEAD_CONTENT_HOOK_SHA256)
    const nestedFunctions = readNestedFunctions(definitions)
    expect(nestedFunctions).toHaveLength(13)
    expect(hash(nestedFunctions)).toBe(HEAD_NESTED_FUNCTION_SHA256)
  })

  it('preserves native listeners, timers, identity payloads, and compatibility gates', () => {
    const definitions = readDefinitions()
    const native = readNativeAndTimerFacts(definitions)
    expect(native.registrations).toHaveLength(6)
    expect(hash(native.registrations)).toBe(HEAD_NATIVE_REGISTRATION_SHA256)
    expect(native.removals).toHaveLength(8)
    expect(hash(native.removals)).toBe(HEAD_NATIVE_REMOVAL_SHA256)
    expect(native.creations.filter((fact) => fact.startsWith('setTimeout'))).toHaveLength(7)
    expect(native.creations.filter((fact) => fact.startsWith('setInterval'))).toHaveLength(1)
    expect(
      native.creations.filter((fact) => fact.startsWith('requestAnimationFrame'))
    ).toHaveLength(1)
    expect(hash(native.creations)).toBe(HEAD_TIMER_CREATION_SHA256)
    expect(native.cleanups.filter((fact) => fact.startsWith('clearTimeout'))).toHaveLength(11)
    expect(native.cleanups.filter((fact) => fact.startsWith('clearInterval'))).toHaveLength(1)
    expect(native.cleanups.filter((fact) => fact.startsWith('cancelAnimationFrame'))).toHaveLength(
      1
    )
    expect(hash(native.cleanups)).toBe(HEAD_TIMER_CLEANUP_SHA256)
    const compatibility = readCompatibilityFacts(definitions)
    expect(compatibility.identityFields).toHaveLength(16)
    expect(hash(compatibility.identityFields)).toBe(HEAD_IDENTITY_FIELD_SHA256)
    // 9 since 2026-09-18: the three new session-menu router.push navigators —
    // see HEAD_NAVIGATION_SHA256.
    expect(compatibility.navigation).toHaveLength(9)
    expect(hash(compatibility.navigation)).toBe(HEAD_NAVIGATION_SHA256)
    expect(compatibility.capabilities).toHaveLength(5)
    expect(hash(compatibility.capabilities)).toBe(HEAD_CAPABILITY_SHA256)
  })

  it('preserves runtime strings, styles, and the expanded JSX tree', () => {
    const strings = readRuntimeStrings()
    // 620 since 2026-09-09: two align="center" props on the empty-state buttons.
    // 622 since 2026-09-09 (night): "data" and "string", from the guard that
    // strips the agents' HUD beacon out of an output chunk.
    // 629 since 2026-09-10: split-sibling Close names the handle-repeat plan.
    // 637 since 2026-09-15: a markdown file renders as a document with a source
    // toggle, the way the desktop has always shown it, instead of as raw text.
    // 654 since 2026-09-15 (later): the .md TAB gets its own Preview/Edit
    // toggle, so opening a document reads it instead of opening an editor.
    // 656 since 2026-09-15 (later): the hostId search param and the two
    // document statuses the reconnect refetch reads.
    // 654 since 2026-09-18: the header's model pill stopped reading the
    // session-options snapshot — its `'model'` category lookup and `'Model'`
    // placeholder check are gone — and reads the agent's live pair instead.
    // Check: `git show 17c20ff..HEAD -- MobileSessionHeader.tsx` removes exactly
    // those two literals.
    // 656 since 2026-09-18 (later): askAboutFileLines's refusal toast and its
    // 'terminal' literal, landing the same day as the model-pill removal above
    // dropped the count to 654.
    // 658 since 2026-09-18 (later still): handleForkClaudeSession's two toast
    // strings ("Forking from the latest message" / "Couldn't fork the session").
    // 673 since 2026-09-18 (newest): the three new session-menu entries —
    // MCP Servers / Permission Rules / Project Memory — see HEAD_RUNTIME_STRING_SHA256.
    expect(strings).toHaveLength(673)
    expect(hash(strings)).toBe(HEAD_RUNTIME_STRING_SHA256)
    const jsx = readJsxFacts(readDefinitions())
    // 95 since 2026-09-15: the markdown preview's own host element.
    // 99 since 2026-09-15 (later): the .md tab's Preview/Edit toggle — its bar,
    // the two pressables it maps, and the preview's own scroller.
    expect(jsx.host).toHaveLength(99)
    expect(hash(jsx.host)).toBe(HEAD_HOST_JSX_SHA256)
    // 69 since 2026-09-15: the markdown preview's own leaf element.
    // 71 since 2026-09-15 (later): the .md tab's Preview/Edit toggle — the icon
    // and the label inside each of the two pressables fold to two leaf records.
    // 72 since 2026-09-18: the file reader's line-selection action bar.
    // 73 since 2026-09-18 (later): the subagent transcript modal mounted by the
    // session content.
    expect(jsx.leaf).toHaveLength(73)
    expect(hash(jsx.leaf)).toBe(HEAD_LEAF_JSX_SHA256)
    // 92 since 2026-09-15: the markdown preview's own style reference.
    expect(jsx.styleReferences).toHaveLength(92)
    expect(hash(jsx.styleReferences)).toBe(HEAD_STYLE_REFERENCE_SHA256)
  })
})
