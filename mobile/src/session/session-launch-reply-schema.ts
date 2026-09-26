import { z } from 'zod'
import { salvagedOptional, salvagingArray } from '../../../src/shared/zod-salvage'

// The replies the session screen's launch paths read: opening a tapped file, creating a markdown
// note or a browser tab, the legacy-Codex resume repin, the structured-agent probe and create, and
// the session-option write. Checked against RuntimeFileOpenResult in
// src/shared/runtime-file-contracts.ts and the handlers in src/main/runtime/rpc/methods/files.ts,
// browser-core.ts, ai-vault.ts, agent-session.ts and client-ui.ts.

/**
 * Whether the host actually opened the tapped file.
 *
 * `opened` is required and boolean, because openMobileFileTapAsync reads it with no guard and
 * routes the whole tap on it — main read a reply without one as "not opened", which is the same
 * answer a real `false` gets, so a host whose reply shape drifted was indistinguishable from one
 * that declined the open. An incompatible reply reaches the same `reportOpenFailure` through
 * openMobileFileTap's own catch, which names it as an unreadable reply.
 *
 * `kind` is salvaged: it only picks the words of a declined open's failure line
 * (RuntimeFileOpenResult declines `binary` alone today), so a reply without one still routes on
 * `opened`.
 */
export const fileTapOpenedSchema = z.looseObject({
  opened: z.boolean(),
  kind: salvagedOptional('kind', z.string())
})

/**
 * The files a bare tapped name might be, from `files.searchPaths` or the `files.list` inventory.
 *
 * `files` is required, and each row needs a string `relativePath`: the lookup filters them by base
 * name, so a reply with no list cannot say "no such file". It is unreadable, and the tap says so
 * instead of calling the file missing. A row without a path drops, as it does for the composer.
 *
 * `truncated` is why this is not the composer's `workspace-files` reader, which answers the path
 * list alone. Both methods set it when the answer is not the whole workspace: the search when its
 * limit cut the matches or the host's 20,000-file inventory was capped, the list at its 5,000.
 * The picker says so when it offers several; a lone match opens even from a cut list, since a
 * one-row sheet was only a step in the way (2026-09-26). Salvaged, because a reply without it is
 * still a list; the lookup then judges a search by its length alone.
 */
export const fileTapNameMatchesSchema = z
  .looseObject({
    files: salvagingArray(z.looseObject({ relativePath: z.string() })),
    truncated: salvagedOptional('truncated', z.boolean())
  })
  .transform((reply) => ({
    paths: reply.files.map((file) => file.relativePath),
    truncated: reply.truncated === true
  }))

/**
 * The browser tab a user opens from the tab strip.
 *
 * `browserPageId` is optional — use-mobile-session-content-create-actions.ts:126 reads it behind a
 * truthy check and only uses it to focus the new tab — but the object around it is required,
 * because main dereferenced the payload on that same line.
 */
export const browserTabCreatedSchema = z.looseObject({
  browserPageId: salvagedOptional('browserPageId', z.string())
})

/**
 * The legacy-Codex resume repin.
 *
 * Nullish and nothing required: ai-vault-resume-preparation.ts:53-58 reads both members through
 * `?.`, and an older host that cannot repin refuses rather than answering, which the call site
 * already handles off the raw reply. Both members are typed because both comparisons are exact —
 * `=== true` and `typeof === 'string'` — so a value of another type was never a repin.
 */
export const aiVaultResumePreparationSchema = z
  .looseObject({
    useRealCodexHome: salvagedOptional('useRealCodexHome', z.boolean()),
    substituteCodexHome: salvagedOptional('substituteCodexHome', z.string())
  })
  .nullish()

/**
 * The four launch replies no call site interprets.
 *
 * `files.createFile` is read for its refusal message only, the structured-agent probe and create
 * are examined envelope-first at the call site because anything they cannot prove is a definitive
 * refusal has to stay unknown, and the session-option write swallows every outcome. Declaring a
 * member on any of them would be a requirement with no reader behind it.
 */
export const sessionLaunchUnreadReplySchema = z.unknown()
