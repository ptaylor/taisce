// Undo as source-range operations, not snapshots: each entry is the text a
// block (or a single marker) had before and after an edit, so a long note does
// not cost a copy per keystroke. Ops are applied in reverse order, which keeps
// the stored offsets valid.
export function createHistory(limit = 50) {
  let undoStack = [];
  let redoStack = [];
  let depth = Math.max(1, limit);

  function trim() {
    while (undoStack.length > depth) undoStack.shift();
  }

  return {
    /** @param {{start: number, before: string, after: string}} op */
    record(op) {
      if (op.before === op.after) return;
      undoStack.push(op);
      redoStack = [];
      trim();
    },
    undo() {
      const op = undoStack.pop();
      if (!op) return null;
      redoStack.push(op);
      return op;
    },
    redo() {
      const op = redoStack.pop();
      if (!op) return null;
      undoStack.push(op);
      return op;
    },
    clear() {
      undoStack = [];
      redoStack = [];
    },
    setLimit(next) {
      depth = Math.max(1, Math.floor(next) || 1);
      trim();
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoDepth: () => undoStack.length,
    redoDepth: () => redoStack.length,
    limit: () => depth,
  };
}

export const UNDO_DEFAULT = 50;
export const UNDO_MAX = 200;

/** Clamp a stored preference so a hand-edited value cannot break the editor. */
export function undoLimit(raw) {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(value)) return UNDO_DEFAULT;
  return Math.min(UNDO_MAX, Math.max(1, value));
}
