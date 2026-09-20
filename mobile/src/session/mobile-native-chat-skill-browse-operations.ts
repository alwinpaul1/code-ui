import { z } from 'zod'
import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc-operation'
import { rpcResultVariant } from '../transport/rpc-operation-result-reader'

/**
 * `files.browseServerDir`: one directory of the host, by absolute path (or
 * the home directory for ''), as `{ resolvedPath, entries }`. Checked against
 * the 1.4.205 host's reply on 2026-09-20. On the mobile allowlist; the `/`
 * menu's skill listing is the one reader (mobile-native-chat-skill-browse-load.ts).
 * A refusal or a listing that will not parse is null: that root is empty.
 */
const serverDirectorySchema = z
  .looseObject({
    resolvedPath: z.string(),
    entries: z.array(
      z
        .looseObject({
          name: z.string(),
          isDirectory: z.boolean(),
          isSymlink: z.boolean().optional()
        })
        .transform((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory,
          isSymlink: entry.isSymlink ?? false
        }))
    )
  })
  .transform((dir) => ({ resolvedPath: dir.resolvedPath, entries: dir.entries }))

export const serverDirectoryBrowse = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'files.browse-server-dir',
    method: 'files.browseServerDir',
    acceptance: 'object-result-or-null',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('server-directory', serverDirectorySchema)
  })
)
