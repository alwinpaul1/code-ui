/**
 * The native half of the 0.9.140 fix ("WebSocket connection origin is not allowed", 2026-10-14):
 * modules/orca-voice-socket must build its upgrade request with no Origin header. Nothing in
 * JavaScript can see the request OkHttp sends, so this reads the Kotlin, with its comments taken
 * out first (the files explain the Origin at length, and prose must not satisfy or trip a pin).
 * VoiceSocketRequestTest.kt checks the same request on the JVM.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MODULE_DIR = path.resolve(import.meta.dirname, '../../modules/orca-voice-socket')
const KOTLIN_DIR = path.join(MODULE_DIR, 'android/src/main/java/expo/modules/orcavoicesocket')

/** Kotlin source with block and line comments removed (no string here contains comment markers). */
function code(file: string): string {
  return readFileSync(path.join(KOTLIN_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

describe('the native voice socket', () => {
  it('builds its request with no Origin header and drops one the caller passed', () => {
    const request = code('VoiceSocketRequest.kt')
    expect(request).toMatch(/internal fun voiceSocketRequest\(url: String, headers: Map<String, String>\): Request/)
    // Every header added is one from the caller, and an origin among them is skipped.
    expect(request.match(/\.(addHeader|header)\(/g)).toEqual(['.addHeader('])
    expect(request).toMatch(/if \(!name\.equals\("origin", ignoreCase = true\)\) \{\s*builder\.addHeader\(name, value\)/)
    expect(request).not.toMatch(/(addHeader|header)\(\s*"origin"/i)
  })

  it('opens every socket with that request and builds no other', () => {
    const module = code('OrcaVoiceSocketModule.kt')
    expect(module.match(/newWebSocket\(/g)).toHaveLength(1)
    expect(module).toMatch(/newWebSocket\(voiceSocketRequest\(url, headers\), listenerFor\(id\)\)/)
    expect(module).not.toMatch(/Request\.Builder|addHeader|[Oo]rigin/)
    // One client for every socket.
    expect(module.match(/OkHttpClient\.Builder\(\)/g)).toHaveLength(1)
  })

  it('is registered under the name the Android opener asks for', () => {
    const config = JSON.parse(readFileSync(path.join(MODULE_DIR, 'expo-module.config.json'), 'utf8'))
    expect(config.android.modules).toEqual(['expo.modules.orcavoicesocket.OrcaVoiceSocketModule'])
    expect(code('OrcaVoiceSocketModule.kt')).toMatch(/Name\("OrcaVoiceSocket"\)/)
    const opener = readFileSync(path.join(import.meta.dirname, 'voice-socket-opener.android.ts'), 'utf8')
    expect(opener).toMatch(/export const VOICE_SOCKET_MODULE = 'OrcaVoiceSocket'/)
  })
})
