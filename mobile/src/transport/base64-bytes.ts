// Base64 <-> bytes for the relay link. Kept free of React Native imports so it
// can be exercised directly: `e2ee.ts` reaches for expo-crypto, which a Node
// test run cannot parse.

// Why batched: this runs over every outbound RPC body, and an image paste is
// megabytes of it. Appending one character at a time builds a rope the engine
// has to keep flattening — measured 5-9x slower than this on V8 from 64 KB up,
// and Hermes has no JIT to hide the difference. 8192 stays well inside the
// argument count `apply` has to respect.
const BASE64_CHUNK_BYTES = 8192

export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(offset, offset + BASE64_CHUNK_BYTES) as unknown as number[]
    )
  }
  return btoa(binary)
}

export function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
