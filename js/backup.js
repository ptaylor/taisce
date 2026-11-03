// A note's backup is a sibling file: `note.md.bak`. It is written after the note
// is already on screen, replaced on every open, and never allowed to delay or
// break the open. The `.bak` suffix means every `.md`-only listing and index
// ignores it, so a backup never appears as a note or in search.

const NOT_FOUND = /not[_-]?found/i;

/** The sibling copy of a note. */
export function backupPath(path) {
  return `${path}.bak`;
}

async function metadataOrNull(provider, path) {
  try {
    return await provider.metadata(path);
  } catch (error) {
    if (NOT_FOUND.test(error?.message || '')) return null;
    throw error;
  }
}

/**
 * Replace each note's backup, one write at a time per path.
 *
 * `backup(path, text)` returns a promise for tests, but callers must not await
 * it: a backup is housekeeping, and the open it belongs to is already done. It
 * does not reject; a failure goes to `warn`, and the next open tries again.
 */
export function createBackupWriter(provider, { warn = console.warn } = {}) {
  const pending = new Map();

  return function backup(path, text) {
    // Nothing to protect. An empty note would also delete a useful earlier
    // backup and replace it with an empty one; a newly created file opens empty.
    if (!text) return Promise.resolve();

    const target = backupPath(path);
    const previous = pending.get(target) || Promise.resolve();

    const run = previous
      .catch(() => {})
      .then(async () => {
        // Look before deleting: a folder named `note.md.bak` is not a backup,
        // and `files/delete_v2` would take the folder and everything in it.
        const existing = await metadataOrNull(provider, target);
        if (existing && existing.type !== 'file') {
          throw new Error(`not replacing a ${existing.type} at the backup path`);
        }
        if (existing) await provider.remove(target);
        await provider.create(target, text);
      })
      .catch((error) => warn(`could not back up ${target}:`, error));

    pending.set(target, run);
    run.finally(() => {
      if (pending.get(target) === run) pending.delete(target);
    });
    return run;
  };
}
