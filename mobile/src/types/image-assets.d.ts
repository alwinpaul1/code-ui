// Metro hands an image import back as the asset id React Native's Image takes as `source`.
// (vitest's own loader gives a URL string; no test reads the value.)
declare module '*.webp' {
  const source: number
  export default source
}
