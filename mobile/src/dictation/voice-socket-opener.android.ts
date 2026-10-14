import { requireOptionalNativeModule } from 'expo-modules-core'
import {
  openNativeVoiceSocket,
  openWebSocketVoiceSocket,
  type NativeVoiceSocketModule,
  type OpenVoiceSocket
} from './voice-socket'

export const VOICE_SOCKET_MODULE = 'OrcaVoiceSocket'

/**
 * Android (Metro picks this file over voice-socket-opener.ts): voice_stream goes through
 * modules/orca-voice-socket, an OkHttp socket that sends no Origin header. React Native's
 * WebSocket adds one on Android whatever the caller passes, and the server refuses it.
 *
 * The module ships in the same APK as this JavaScript. Were it ever missing, dictation falls back
 * to React Native's WebSocket and says so, since the server will then refuse the origin.
 */
function pickOpener(): OpenVoiceSocket {
  const native = requireOptionalNativeModule<NativeVoiceSocketModule>(VOICE_SOCKET_MODULE)
  if (native === null) {
    console.warn(
      `${VOICE_SOCKET_MODULE} is not in this build: voice dictation uses React Native's WebSocket, which sends an Origin header voice_stream refuses`
    )
    return openWebSocketVoiceSocket
  }
  return openNativeVoiceSocket(native)
}

export const openVoiceSocket: OpenVoiceSocket = pickOpener()
