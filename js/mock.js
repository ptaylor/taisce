import { ConflictError } from './errors.js';
import { baseName, isHiddenName, isHiddenPath, normaliseDir, parentDir } from './paths.js';

// A fake backend with the same contract as DropboxProvider, so the whole UI can
// be worked on — and shown — without an account. `?mock=1` is the only way to
// get it; there is no production code path that silently fakes a save.
const KEY = 'taisce.mock.v2';

const WELCOME = [
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
  'const saved = await engine.save();',
  '```',
  '',
  'A [link](https://www.markdownlang.com/) has its own editor: tap it to change the\n' +
  'address, copy it or remove it.',
  '',
  'Open the **notes** folder to see nested files.',
].join('\n');

const SAMPLE = {
  folders: ['/notes', '/notes/2026'],
  files: {
    '/welcome.md': WELCOME,
    '/shopping.md': ['# Shopping', '', '- [ ] milk', '- [ ] bread', '- [x] coffee'].join('\n'),
    '/notes/ideas.md': ['# Ideas', '', '- [ ] Try folders', '- [x] Try nesting'].join('\n'),
    '/notes/2026/october.md': ['# October', '', 'A file two levels down.'].join('\n'),
    '/notes/readme.txt': 'not markdown, should not be listed',
  },
};

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function seed() {
  const data = { folders: [...SAMPLE.folders], files: {}, images: {}, pdfs: {} };
  const now = Date.now();
  Object.entries(SAMPLE.files).forEach(([path, text], index) => {
    // Staggered so the demo has a believable "recently modified" order.
    data.files[path] = { rev: 'r1', text, modified: now - index * 3_600_000 };
  });
  localStorage.setItem(KEY, JSON.stringify(data));
  return data;
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seed();
    const data = JSON.parse(raw);
    if (!data || !data.files || !data.folders) return seed();
    if (!data.images) data.images = {};
    if (!data.pdfs) data.pdfs = {};
    return data;
  } catch {
    return seed();
  }
}

function write(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function createMockProvider() {
  read();
  const wait = () => new Promise((resolve) => setTimeout(resolve, 60));

  return {
    label: 'demo data',
    disconnectLabel: 'Reset demo data',
    disconnectBody: 'Clears the demo files from this browser and starts over. Nothing in Dropbox is touched.',

    async list(dir = '') {
      await wait();
      const at = normaliseDir(dir);
      const data = read();

      const folders = data.folders
        .filter((path) => parentDir(path) === at && !isHiddenName(baseName(path)))
        .map((path) => ({ name: baseName(path), path, type: 'folder' }));

      const files = Object.keys(data.files)
        .filter((path) => parentDir(path) === at && /\.md$/i.test(path))
        .filter((path) => !isHiddenName(baseName(path)))
        .sort((a, b) => a.localeCompare(b))
        .map((path) => ({ name: baseName(path).replace(/\.md$/i, ''), path, type: 'file' }));

      return [...folders, ...files];
    },

    async index() {
      await wait();
      return Object.entries(read().files)
        .filter(([path]) => /\.md$/i.test(path) && !isHiddenPath(path))
        .map(([path, entry]) => ({
          name: baseName(path).replace(/\.md$/i, ''),
          path,
          modified: entry.modified || 0,
        }));
    },

    async metadata(path) {
      await wait();
      const data = read();
      if (data.folders.includes(path)) return { type: 'folder' };
      if (data.pdfs && data.pdfs[path]) return { type: 'file' };
      const entry = data.files[path];
      if (!entry) throw new Error('path/not_found');
      return { type: 'file', rev: entry.rev };
    },

    async read(path) {
      await wait();
      const entry = read().files[path];
      if (!entry) throw new Error('file not found');
      return { text: entry.text, rev: entry.rev };
    },

    async write(path, text, rev) {
      await wait();
      const data = read();
      const entry = data.files[path];
      if (!entry) throw new Error('file not found');
      if (rev && entry.rev !== rev) throw new ConflictError('conflict');
      const next = 'r' + (Number(entry.rev.slice(1)) + 1);
      data.files[path] = { rev: next, text, modified: Date.now() };
      write(data);
      return { rev: next };
    },

    async create(path, text = '') {
      await wait();
      const data = read();
      if (data.files[path] || data.folders.includes(path)) throw new ConflictError('conflict');
      data.files[path] = { rev: 'r1', text, modified: Date.now() };
      write(data);
      return { rev: 'r1' };
    },

    async uploadFile(path, blob) {
      await wait();
      const data = read();
      if (data.files[path] || data.folders.includes(path)) throw new ConflictError('conflict');
      data.images[path] = await blobToDataUrl(blob);
      write(data);
      return { path, rev: 'img1' };
    },

    async writePdf(path, bytes) {
      await wait();
      const data = read();
      if (data.folders.includes(path)) throw new ConflictError('conflict');
      data.pdfs[path] = await blobToDataUrl(new Blob([bytes], { type: 'application/pdf' }));
      write(data);
      return { path };
    },

    async readBlob(path) {
      await wait();
      const data = read();
      const dataUrl = data.images[path] || (data.pdfs && data.pdfs[path]);
      if (!dataUrl) throw new Error('not_found');
      return (await fetch(dataUrl)).blob();
    },

    async createFolder(path) {
      await wait();
      const at = normaliseDir(path);
      const data = read();
      if (!at) throw new ConflictError('conflict');
      if (data.folders.includes(at) || data.files[at]) throw new ConflictError('conflict');
      if (parentDir(at) && !data.folders.includes(parentDir(at))) throw new Error('path/not_found');
      data.folders.push(at);
      write(data);
      return { path: at };
    },

    // The demo has no Dropbox to ask, so the link is a plausible stand-in that
    // behaves like one: stable for a file, and viewable rather than downloading.
    async shareLink(path) {
      await wait();
      const name = path.split('/').pop();
      return `https://www.dropbox.com/scl/fi/taisce-demo/${name}?rlkey=demo&dl=0`;
    },

    // No trash in the demo: the file is gone, and Reset demo data brings the
    // whole sample back. An upload and a note share this one call, so it clears
    // whichever kind of entry the path names.
    async remove(path) {
      await wait();
      const data = read();
      if (data.files[path]) delete data.files[path];
      else if (data.images[path]) delete data.images[path];
      else if (data.pdfs && data.pdfs[path]) delete data.pdfs[path];
      else throw new Error('path/not_found');
      write(data);
      return { path };
    },

    async disconnect() {
      localStorage.removeItem(KEY);
    },
  };
}
