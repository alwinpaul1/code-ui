import { openWebSocketVoiceSocket, type OpenVoiceSocket } from './voice-socket'

/**
 * iOS, web and tests: the JavaScript WebSocket. Android has its own file
 * (voice-socket-opener.android.ts), which Metro picks over this one.
 */
export const openVoiceSocket: OpenVoiceSocket = openWebSocketVoiceSocket
