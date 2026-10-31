import { ConflictError } from './errors.js';

// A fake backend with the same contract as DropboxProvider, so the whole UI can
// be worked on — and shown — without an account. `?mock=1` is the only way to
// get it; there is no production code path that silently fakes a save.
const KEY = 'taisce.mock.v1';

const SAMPLE = {
  'welcome.md': [
    '# Welcome to Taisce',
    '',
    'Tap a paragraph to edit it. The Markdown you type is the formatting:',
    '`## ` for a heading, `**bold**`, `` `code` ``, `- ` for a list.',
    '',
    '## Things to try',
    '',
    '- [ ] Tick a task item — it saves by itself',
    '- [ ] Type `## ` at the start of a line',
    '- [x] Edit this list',
    '',
    '> There is no Save button. There is also no Cancel button.',
    '',
    '```js',
    "const saved = await engine.save();",
    '```',
    '',
    'A [link](https://www.markdownlang.com/) opens in a new tab.',
  ].join('\n'),
  'shopping.md': ['# Shopping', '', '- [ ] milk', '- [ ] bread', '- [x] coffee'].join('\n'),
};

function seed() {
  if (!localStorage.getItem(KEY)) {
    const data = {};
    for (const [name, text] of Object.entries(SAMPLE)) data['/' + name] = { rev: 'r1', text };
    localStorage.setItem(KEY, JSON.stringify(data));
  }
}

function data() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function createMockProvider() {
  seed();
  const wait = () => new Promise((resolve) => setTimeout(resolve, 60));

  return {
    label: 'demo data',
    disconnectLabel: 'Reset demo data',
    disconnectBody: 'Clears the demo files from this browser and starts over. Nothing in Dropbox is touched.',

    async list() {
      await wait();
      return Object.keys(data())
        .filter((path) => /\.md$/i.test(path))
        .sort((a, b) => a.localeCompare(b))
        .map((path) => ({ name: path.slice(1).replace(/\.md$/i, ''), path }));
    },

    async read(path) {
      await wait();
      const entry = data()[path];
      if (!entry) throw new Error('file not found');
      return { text: entry.text, rev: entry.rev };
    },

    async write(path, text, rev) {
      await wait();
      const files = data();
      const entry = files[path];
      if (!entry) throw new Error('file not found');
      if (rev && entry.rev !== rev) throw new ConflictError('conflict');
      const next = 'r' + (Number(entry.rev.slice(1)) + 1);
      files[path] = { rev: next, text };
      localStorage.setItem(KEY, JSON.stringify(files));
      return { rev: next };
    },

    async create(path, text = '') {
      await wait();
      const files = data();
      if (files[path]) throw new ConflictError('conflict');
      files[path] = { rev: 'r1', text };
      localStorage.setItem(KEY, JSON.stringify(files));
      return { rev: 'r1' };
    },

    async disconnect() {
      localStorage.removeItem(KEY);
    },
  };
}
