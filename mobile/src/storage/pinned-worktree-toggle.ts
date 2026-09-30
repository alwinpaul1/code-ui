import { readPinnedIdsRecord, savePinnedIds } from './preferences'

/** Each host's last pin write, which the next one waits for. */
const writes = new Map<string, Promise<void>>()

/**
 * Writes one pin toggled on this phone over the host's stored pins.
 *
 * A host's pins sit under one key, so a write is the whole set. The toggle
 * used to write the set the screen showed, and when the screen had started
 * from a read storage refused, which came back as no pins, that one-entry set
 * replaced every pin stored before (2026-09-30). The catalog puts the host's
 * own pins back on its next load, but a refused read must never turn into a
 * write that erases.
 *
 * So the stored pins are read first, once more after a refusal: storage still
 * refusing gets no write and one line says why, and the screen's own pins
 * stay as they are. Read, the stored pins, those the screen shows, and this
 * toggle are written together; only the toggled id can leave the set. A
 * missing or unparseable value is no pins. Toggles for one host are written
 * in the order they were made, so a quick second toggle cannot write over
 * the first from a read taken before it landed.
 */
export function savePinToggle(
  hostId: string,
  shown: ReadonlySet<string>,
  worktreeId: string,
  pinned: boolean
): Promise<void> {
  const write = (writes.get(hostId) ?? Promise.resolve()).then(() => writeToggle(hostId, shown, worktreeId, pinned))
  writes.set(hostId, write)
  void write.then(() => {
    if (writes.get(hostId) === write) {
      writes.delete(hostId)
    }
  })
  return write
}

async function writeToggle(hostId: string, shown: ReadonlySet<string>, worktreeId: string, pinned: boolean): Promise<void> {
  let read = await readPinnedIdsRecord(hostId)
  if ('refused' in read) {
    read = await readPinnedIdsRecord(hostId)
  }
  if ('refused' in read) {
    console.warn(
      '[storage] could not save a pin: the stored pins could not be read, and writing over them would erase them',
      read.refused
    )
    return
  }
  const next = new Set([...read.ids, ...shown])
  if (pinned) {
    next.add(worktreeId)
  } else {
    next.delete(worktreeId)
  }
  try {
    await savePinnedIds(hostId, next)
  } catch (error) {
    // Never passed on: the next toggle waits behind this one.
    console.warn('[storage] could not save the pinned worktrees', error)
  }
}
