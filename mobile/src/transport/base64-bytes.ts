// Base64 <-> bytes for the relay link. Kept free of React Native imports so it
// can be exercised directly: `e2ee.ts` reaches for expo-crypto, which a Node
// test run cannot parse.
//
// One implementation, in base64-byte-codec.ts, shared with the v2 text frames and the image
// uploader (Orca #24665): it converts 8190 bytes at a time, so no binary string the size of the
// whole frame is ever built, which on a multi-megabyte reply was the heap peak. Appending one
// character at a time over a whole payload builds a rope the engine has to keep flattening
// (measured 5-9x slower from 64 KB up on V8), and a short string per chunk avoids that too.
export {
  encodeBase64Bytes as uint8ToBase64,
  decodeBase64Bytes as base64ToUint8
} from './base64-byte-codec'
