import { accessToken, signOut, store } from './auth.js';
import { AuthError, ConflictError } from './errors.js';

const RPC_HOST = 'https://api.dropboxapi.com/2/';
const CONTENT_HOST = 'https://content.dropboxapi.com/2/';

async function messageFrom(res) {
  const raw = await res.text().catch(() => '');
  try {
    const body = JSON.parse(raw);
    return body.error_description || body.error_summary || String(body.error) || raw;
  } catch {
    return raw || `HTTP ${res.status}`;
  }
}

export class DropboxProvider {
  constructor(appKey) {
    this.appKey = appKey;
    this.label = 'Dropbox';
    this.disconnectLabel = 'Disconnect Dropbox';
    this.disconnectBody =
      'Forgets the tokens stored on this device and revokes them at Dropbox, ' +
      'so you will need to authorise again next time. Your files are not touched.';
  }

  async token() {
    return accessToken(this.appKey);
  }

  async toError(res, { conflictIsSpecial = true } = {}) {
    const message = await messageFrom(res);
    if (res.status === 401) {
      store.access = null;
      return new AuthError(message);
    }
    if (res.status === 409 && conflictIsSpecial) return new ConflictError(message);
    if (res.status === 429) return new Error('rate limited — try again shortly');
    return new Error(message);
  }

  async rpc(endpoint, arg) {
    const token = await this.token();
    const res = await fetch(RPC_HOST + endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(arg),
    });
    if (!res.ok) throw await this.toError(res);
    return res.json();
  }

  async content(endpoint, arg, body) {
    const token = await this.token();
    const res = await fetch(CONTENT_HOST + endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify(arg),
      },
      body,
    });
    if (!res.ok) throw await this.toError(res);
    return res;
  }

  /**
   * One level of the app folder: its folders and its Markdown files. The
   * `.md` extension is not part of the name people see.
   * @param {string} dir
   * @returns {Promise<{name: string, path: string, type: 'folder'|'file'}[]>}
   */
  async list(dir = '') {
    let page = await this.rpc('files/list_folder', { path: dir, recursive: false, limit: 2000 });
    const entries = [...page.entries];
    while (page.has_more) {
      page = await this.rpc('files/list_folder/continue', { cursor: page.cursor });
      entries.push(...page.entries);
    }

    return entries
      .filter((entry) => entry['.tag'] === 'folder' || (entry['.tag'] === 'file' && /\.md$/i.test(entry.name)))
      .map((entry) => ({
        name: entry['.tag'] === 'folder' ? entry.name : entry.name.replace(/\.md$/i, ''),
        path: entry.path_lower,
        type: entry['.tag'] === 'folder' ? 'folder' : 'file',
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * Every Markdown file in the app folder, with the time Dropbox last changed
   * it. One recursive listing powers both "recent files" and search.
   * @returns {Promise<{name: string, path: string, modified: number}[]>}
   */
  async index() {
    let page = await this.rpc('files/list_folder', { path: '', recursive: true, limit: 2000 });
    const entries = [...page.entries];
    while (page.has_more) {
      page = await this.rpc('files/list_folder/continue', { cursor: page.cursor });
      entries.push(...page.entries);
    }

    return entries
      .filter((entry) => entry['.tag'] === 'file' && /\.md$/i.test(entry.name))
      .map((entry) => ({
        name: entry.name.replace(/\.md$/i, ''),
        path: entry.path_lower,
        modified: Date.parse(entry.server_modified) || 0,
      }));
  }

  /**
   * @param {string} path
   * @returns {Promise<{text: string, rev: string}>}
   */
  async read(path) {
    const res = await this.content('files/download', { path });
    const meta = JSON.parse(res.headers.get('Dropbox-API-Result') || 'null');
    const text = await res.text();
    // The metadata header is CORS-exposed; fall back to a lookup if a proxy in
    // front of the API strips it.
    const rev = meta?.rev || (await this.rpc('files/get_metadata', { path })).rev;
    return { text, rev };
  }

  async write(path, text, rev) {
    const arg = {
      path,
      mode: rev ? { '.tag': 'update', update: rev } : { '.tag': 'overwrite' },
      autorename: false,
      mute: true,
      strict_conflict: true,
    };
    const res = await this.content('files/upload', arg, new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const meta = await res.json();
    return { rev: meta.rev };
  }

  async create(path, text = '') {
    const res = await this.content(
      'files/upload',
      { path, mode: { '.tag': 'add' }, autorename: false, mute: true, strict_conflict: true },
      new Blob([text], { type: 'text/markdown;charset=utf-8' }),
    );
    const meta = await res.json();
    return { rev: meta.rev };
  }

  /** Upload bytes without ever renaming: an image must not silently land elsewhere. */
  async uploadFile(path, blob) {
    const res = await this.content(
      'files/upload',
      { path, mode: { '.tag': 'add' }, autorename: false, mute: true },
      blob,
    );
    const meta = await res.json();
    return { path: meta.path_lower, rev: meta.rev };
  }

  async readBlob(path) {
    const res = await this.content('files/download', { path });
    return res.blob();
  }

  async createFolder(path) {
    const result = await this.rpc('files/create_folder_v2', { path, autorename: false });
    return { path: result.metadata.path_lower };
  }

  /** Revoke first, so the grant really ends, then forget it locally. */
  async disconnect() {
    try {
      const token = await this.token();
      await fetch(RPC_HOST + 'auth/token/revoke', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Token already invalid or offline: local sign-out still applies.
    }
    signOut();
  }
}
