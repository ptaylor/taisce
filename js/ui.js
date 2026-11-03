export const $ = (selector, root = document) => root.querySelector(selector);

let toastTimer = 0;

export function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3600);
}

export function setStatus(kind, detail) {
  const el = $('#subtitle');
  if (!el) return;

  const when = detail instanceof Date ? detail.toTimeString().slice(0, 8) : '';
  const text =
    {
      loading: 'Loading…',
      loaded: 'Loaded',
      ready: detail || '',
      editing: 'Unsaved changes',
      saving: 'Saving…',
      deleting: 'Deleting…',
      saved: when ? `Saved ${when}` : 'Saved',
      error: detail ? `⚠ ${detail}` : '⚠ Error',
    }[kind] ?? '';

  el.textContent = text;
  el.dataset.state = kind;
}

export function setScreen(name, { back = name === 'file' } = {}) {
  for (const screen of ['auth', 'list', 'file']) {
    const el = $(`#screen-${screen}`);
    if (el) el.hidden = screen !== name;
  }
  const backButton = $('#back');
  if (backButton) backButton.hidden = !back;
  const newButton = $('#new');
  if (newButton) newButton.hidden = name !== 'list';
}

export function setTitle(text) {
  const el = $('#title');
  if (el) el.textContent = text;
}

/**
 * A confirmation. `danger` marks the accept button as destructive, so the
 * primary-coloured button is never the one that deletes something.
 */
export function ask({ title, body, ok, danger = false }) {
  return new Promise((resolve) => {
    const dialog = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    $('#confirm-ok').textContent = ok;
    $('#confirm-ok').classList.toggle('danger', danger);

    const finish = (value) => {
      $('#confirm-ok').onclick = null;
      $('#confirm-cancel').onclick = null;
      dialog.onclose = null;
      if (dialog.open) dialog.close();
      resolve(value);
    };

    $('#confirm-ok').onclick = () => finish(true);
    $('#confirm-cancel').onclick = () => finish(false);
    dialog.onclose = () => finish(false);
    dialog.showModal();
  });
}

/**
 * Cover the screen while something is being fetched, so a wait never looks like
 * the previous screen holding still. `label` says what is being waited for.
 */
export function showBusy(label = 'Loading…') {
  const el = $('#busy');
  if (!el) return;
  $('#busy-label').textContent = label;
  el.hidden = false;
}

export function hideBusy() {
  const el = $('#busy');
  if (el) el.hidden = true;
}
