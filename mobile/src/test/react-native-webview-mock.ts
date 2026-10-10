// Why: react-native-webview's entry reads react-native's EventEmitter and view-manager config at
// import, which a test that mocks 'react-native' to a few string tags does not provide. The media
// player (MobileMediaPlayback.tsx) imports it, and every file-preview and file-reader test reaches
// that player through the preview body, so none of them could even load. A test that needs to see
// the WebView's props still mocks 'react-native-webview' itself, which wins over this alias.
export function WebView(): null {
  return null
}
export default WebView
