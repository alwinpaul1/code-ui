import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import ts from 'typescript-api'
import { parse } from '../navigation/router-seam-census.test-support'

/**
 * Which engine the phone dictates with, read off the modules that decide it.
 *
 * Why a source census (2026-09-23, upstream #21905): upstream moved its dictation hook's microphone
 * and wake calls behind `platform/dictation-capture`, so the OTA page can dictate over the shell's
 * native audio verbs. This fork's chat dictates with the PHONE's recognizer first
 * (`useMobileLiveTranscription`, 6f89a882: tap to start, insert at the caret, stop after silence)
 * and keeps upstream's desktop-transcription hook only as the fallback for a phone with no
 * recognizer. That split has no behavioural handle a unit test can reach — both hooks work on their
 * own — and a later port that took upstream's session wiring over this fork's would make every
 * phone dictate through the desktop without one test going red. So the wiring is read here, from
 * code, not comments.
 */
const SRC = join(import.meta.dirname, '..')

type Imports = Map<string, Set<string>>

function valueImports(source: ts.SourceFile): Imports {
  const imports: Imports = new Map()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly === true) {
      continue
    }
    const specifier = statement.moduleSpecifier
    if (!ts.isStringLiteral(specifier)) {
      continue
    }
    const names = imports.get(specifier.text) ?? new Set<string>()
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) {
          names.add((element.propertyName ?? element.name).text)
        }
      }
    }
    if (statement.importClause?.name) {
      names.add('default')
    }
    imports.set(specifier.text, names)
  }
  return imports
}

/** The source text of every call to `callee`, printed without comments. */
function callsTo(source: ts.SourceFile, callee: string): string[] {
  const printer = ts.createPrinter({ removeComments: true })
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === callee) {
      found.push(printer.printNode(ts.EmitHint.Expression, node, source))
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(source, visit)
  return found
}

describe('chat dictation on the phone', () => {
  const session = parse(SRC, 'session/use-mobile-session-native-chat-dictation.ts')
  const sessionImports = valueImports(session)

  it('holds both engines: the phone recognizer and the desktop fallback', () => {
    expect(sessionImports.get('../hooks/use-mobile-live-transcription')).toContain(
      'useMobileLiveTranscription'
    )
    expect(sessionImports.get('../hooks/use-mobile-dictation')).toContain('useMobileDictation')
    expect(callsTo(session, 'useMobileLiveTranscription')).toHaveLength(1)
    expect(callsTo(session, 'useMobileDictation')).toHaveLength(1)
  })

  it('takes the phone recognizer whenever it is available', () => {
    expect(sessionImports.get('../dictation/dictation-engine')).toContain('chooseDictationEngine')
    expect(callsTo(session, 'chooseDictationEngine')).toEqual([
      'chooseDictationEngine(liveTranscription.available)'
    ])
  })
})

describe('the phone recognizer', () => {
  const live = parse(SRC, 'hooks/use-mobile-live-transcription.ts')
  const liveImports = valueImports(live)

  it('listens through expo-speech-recognition', () => {
    expect(liveImports.get('expo-speech-recognition')).toContain('ExpoSpeechRecognitionModule')
  })

  it('never goes through the page capture seam or the raw microphone the desktop path uses', () => {
    // Those belong to the desktop fallback. A recognizer routed through them would stop printing
    // partials as the user speaks, which is the whole of why it is the first choice.
    const reached = [...liveImports.keys()].filter(
      (specifier) =>
        specifier.includes('platform/dictation-capture') ||
        specifier === '@orca/expo-two-way-audio' ||
        specifier === 'expo-keep-awake'
    )
    expect(reached).toEqual([])
  })
})
