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
      saved: when ? `Saved ${when}` : 'Saved',
      error: detail ? `⚠ ${detail}` : '⚠ Error',
    }[kind] ?? '';

  el.textContent = text;
  el.dataset.state = kind;
}

export function setScreen(name) {
  for (const screen of ['auth', 'list', 'file']) {
    const el = $(`#screen-${screen}`);
    if (el) el.hidden = screen !== name;
  }
  const back = $('#back');
  if (back) back.hidden = name !== 'file';
  const newButton = $('#new');
  if (newButton) newButton.hidden = name !== 'list';
}

export function setTitle(text) {
  const el = $('#title');
  if (el) el.textContent = text;
}

export function ask({ title, body, ok }) {
  return new Promise((resolve) => {
    const dialog = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    $('#confirm-ok').textContent = ok;

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
