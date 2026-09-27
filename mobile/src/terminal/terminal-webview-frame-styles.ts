import { StyleSheet } from 'react-native'
import { darkColors } from '../theme/tokens'

// Fixed, not the live app theme: the terminal WebView frame stays Tokyonight-dark in both app
// schemes (BRIEF: terminal content stays terminal-coloured). `darkColors.terminalBg` equals
// `lightColors.terminalBg` on purpose.
export const TERMINAL_WEBVIEW_FRAME_STYLES = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: darkColors.terminalBg
  },
  webview: {
    flex: 1,
    backgroundColor: darkColors.terminalBg
  }
})
