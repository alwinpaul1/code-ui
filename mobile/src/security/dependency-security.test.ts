import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const router = createRequire(require.resolve('expo-router/package.json'))
const expoPackage = createRequire(require.resolve('expo/package.json'))
const cli = createRequire(expoPackage.resolve('@expo/cli/package.json'))
const plistRequire = createRequire(cli.resolve('@expo/plist'))
const lockfile = readFileSync(fileURLToPath(new URL('../../pnpm-lock.yaml', import.meta.url)), 'utf8')

it('no longer ships image-size at all, patched or otherwise', () => {
  // Through SDK 55 Metro pulled `image-size`, whose latest release still loops
  // on hostile ICNS/JXL/HEIF input, and a checked-in pnpm patch closed that.
  // Metro 0.84 (Expo SDK 57) dropped the dependency, which is the stronger
  // fix — the doc's own condition for removing the patch. This pins the
  // absence, because the earlier tests could not: with no project copy,
  // `require.resolve('image-size')` walks UP out of the repo and finds
  // whatever stray copy sits in `~/node_modules`, and on one machine that
  // was an unpatched 1.2.1 that hung the harness.
  expect(lockfile).not.toMatch(/^\s+'?\/?image-size@/m)
})

it('keeps Expo Router query decoding compatible with the fixed decoder', () => {
  const query = router('query-string').default
  expect(query.parse('message=hello%20world&name=%E2%9C%93&repeat=1&repeat=2')).toEqual({
    message: 'hello world',
    name: '✓',
    repeat: ['1', '2']
  })
  expect(query.parse(query.stringify({ text: 'a + b & c', path: '/some/file.png' }))).toEqual({
    text: 'a + b & c',
    path: '/some/file.png'
  })
})

it('decodes a large malformed URI without blocking', () => {
  // Run the hostile input in a disposable process: a regressed infinite loop
  // must not hang the test runner or allocate memory indefinitely in the CI worker.
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const query = require(process.argv[1]).default;
    const input = '%C2'.repeat(10000);
    const decoded = query.parse('value=' + input);
    if (typeof decoded.value !== 'string') process.exit(1);
  `,
      router.resolve('query-string')
    ],
    { timeout: 1500, encoding: 'utf8' }
  )
  expect(result.error, 'malformed URI must not block').toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
})

it('keeps Expo plist serialization and parsing compatible with latest xmldom', () => {
  const plist = cli('@expo/plist').default
  const value = { CFBundleName: 'Code UI', enabled: true, count: 27, names: ['a', 'b'] }
  expect(plist.parse(plist.build(value))).toEqual(value)
})

it('rejects injected XML entity reference names during well-formed serialization', () => {
  const { DOMImplementation, XMLSerializer } = plistRequire('@xmldom/xmldom')
  const document = new DOMImplementation().createDocument(null, 'root', null)
  const entity = document.createEntityReference('safe')
  entity.nodeName = 'bad;<injected/>&bad'
  expect(() => new XMLSerializer().serializeToString(entity, { requireWellFormed: true })).toThrow()
})
