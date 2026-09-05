// Why: react-native-pdf is a native view; under Vitest the component tree only
// needs a stand-in that renders nothing.
export default function PdfMock(): null {
  return null
}
