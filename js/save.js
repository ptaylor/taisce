import { applyBlockEdits, parseBlocks } from './blocks.js';
import { AuthError, ConflictError } from './errors.js';

const SAVE_DELAY = 700;
const MAX_ATTEMPTS = 5;

/**
 * Autosave with no Save button: debounce, serialise, and never let two uploads
 * race. A 409 is retried once by re-applying the blocks edited locally onto the
 * remote copy; if the structure changed, the remote copy wins and says so.
 *
 * @param {{
 *   provider: {read(path: string): Promise<{text: string, rev: string}>, write(path: string, text: string, rev: string): Promise<{rev: string}>},
 *   onStatus?: (kind: string, detail?: unknown) => void,
 *   onRemote?: (text: string, info: {dropped: boolean}) => void,
 *   onAuthLost?: () => void,
 *   getEdits?: () => {index: number, source: string, type?: string}[],
 * }} options
 */
export function createSaveEngine({
  provider,
  onStatus = () => {},
  onRemote = () => {},
  onAuthLost = () => {},
  getEdits = () => [],
}) {
  let path = null;
  let rev = null;
  let savedText = '';
  let text = '';
  let timer = 0;
  let chain = Promise.resolve();

  const clean = () => text === savedText;

  function open({ path: nextPath, text: nextText, rev: nextRev }) {
    clearTimeout(timer);
    timer = 0;
    path = nextPath;
    text = nextText;
    savedText = nextText;
    rev = nextRev;
    chain = Promise.resolve();
  }

  function close() {
    clearTimeout(timer);
    timer = 0;
    path = null;
    text = '';
    savedText = '';
    rev = null;
    chain = Promise.resolve();
  }

  function setText(next) {
    if (path == null) return;
    text = next;
    scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void save();
    }, SAVE_DELAY);
  }

  function save() {
    clearTimeout(timer);
    timer = 0;
    if (path == null) return Promise.resolve();
    if (clean()) return chain;

    chain = chain.then(async () => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS && path != null && !clean(); attempt += 1) {
        if (!(await performSave())) return;
      }
    });
    return chain;
  }

  async function performSave() {
    let retried = false;

    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const sending = text;
        if (sending === savedText) return true;

        onStatus('saving');
        try {
          const meta = await provider.write(path, sending, rev);
          rev = meta.rev;
          savedText = sending;
          // Only claim clean if nothing was typed while the upload was out.
          if (text === sending) {
            onStatus('saved', new Date());
            return true;
          }
        } catch (err) {
          if (err instanceof ConflictError && !retried) {
            retried = true;
            if (await mergeConflict()) continue;
            return true;
          }
          throw err;
        }
      }
      return true;
    } catch (err) {
      if (err instanceof AuthError) {
        onStatus('error', 'session expired');
        onAuthLost();
      } else {
        onStatus('error', err.message || 'save failed');
      }
      return false;
    }
  }

  // Returns true when the merged copy should be uploaded again.
  async function mergeConflict() {
    const remote = await provider.read(path);
    rev = remote.rev;

    // Blocks were added or removed on one side: a span-level merge would put
    // the wrong text in the wrong place, so the remote copy wins and says so.
    const structural = parseBlocks(text).length !== parseBlocks(remote.text).length;
    const merged = structural ? null : applyBlockEdits(remote.text, getEdits());
    if (merged == null) {
      savedText = remote.text;
      text = remote.text;
      onStatus('saved');
      onRemote(remote.text, { dropped: true });
      return false;
    }

    savedText = remote.text;
    text = merged;
    onRemote(merged, { dropped: false });
    return true;
  }

  return {
    open,
    close,
    setText,
    save,
    flush: save,
    isDirty: () => !clean(),
    path: () => path,
    rev: () => rev,
    text: () => text,
    savedText: () => savedText,
  };
}
