import { accessToken, signOut, store } from './auth.js';
import { AuthError, ConflictError, ScopeError } from './errors.js';
import { isHiddenName, isHiddenPath } from './paths.js';

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
    this.disconnectLabel = 'Disconnect from Dropbox';
    this.disconnectBody =
      'Forgets the tokens stored on this device and asks Dropbox to revoke them, ' +
      'so you will need to authorise again next time. Your files are not touched.';
  }

  async token() {
    return accessToken(this.appKey);
  }

  async toError(res, { conflictIsSpecial = true } = {}) {
    const message = await messageFrom(res);
    if (res.status === 401) {
      // A token that lacks a permission is still a good token: forgetting it
      // would throw the user out of the app over one refused call.
      if (/missing_scope/.test(message)) return new ScopeError(message);
      store.access = null;
      return new AuthError(message);
    }
    if (res.status === 409 && conflictIsSpecial) return new ConflictError(message);
    if (res.status === 429) return new Error('rate limited — try again shortly');
    return new Error(message);
  }

  async rpc(endpoint, arg, options) {
    const token = await this.token();
    const res = await fetch(RPC_HOST + endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(arg),
    });
    if (!res.ok) throw await this.toError(res, options);
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
  /**
   * Every entry `files/list_folder` will give us, following `has_more` cursors.
   * @param {{path: string, recursive: boolean}} arg
   */
  async listAll(arg) {
    let page = await this.rpc('files/list_folder', { ...arg, limit: 2000 });
    const entries = [...page.entries];
    while (page.has_more) {
      page = await this.rpc('files/list_folder/continue', { cursor: page.cursor });
      entries.push(...page.entries);
    }
    return entries;
  }

  async list(dir = '') {
    const entries = await this.listAll({ path: dir, recursive: false });

    return entries
      .filter((entry) => !isHiddenName(entry.name))
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
    const entries = await this.listAll({ path: '', recursive: true });

    return entries
      .filter((entry) => !isHiddenPath(entry.path_lower))
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

  /**
   * Deletes to the Dropbox trash, not into nothing: `files/delete_v2` needs
   * only `files.content.write`, which the app already asks for, and the file
   * stays restorable at dropbox.com until the trash expires.
   */
  async remove(path) {
    await this.rpc('files/delete_v2', { path });
    return { path };
  }

  /**
   * The shared link for one file: the one that already exists, or a new public
   * one. Dropbox keeps links per file, so asking twice yields the same URL —
   * which is what makes it safe to cache and hand to a share sheet.
   */
  async shareLink(path) {
    const existing = await this.findSharedLink(path);
    if (existing) return existing;

    try {
      const created = await this.rpc(
        'sharing/create_shared_link_with_settings',
        { path, settings: { audience: 'public', access: 'viewer' } },
        { conflictIsSpecial: false },
      );
      return created.url;
    } catch (error) {
      // A link made elsewhere between the two calls, or one carrying settings we
      // did not ask for. Looking again is more useful than reporting the clash.
      if (!/shared_link_already_exists/.test(error.message || '')) throw error;
      const found = await this.findSharedLink(path);
      if (!found) throw error;
      return found;
    }
  }

  async findSharedLink(path) {
    const { links = [] } = await this.rpc('sharing/list_shared_links', { path, direct_only: true });
    const match = links.find((link) => (link.path_lower || '').toLowerCase() === path.toLowerCase());
    return match ? match.url : null;
  }

  /**
   * Ask Dropbox to revoke this grant, then forget it locally.
   *
   * The refresh token is the one that lasts, so it is offered first: revoking a
   * short-lived access token alone would leave the long-lived credential alive
   * at Dropbox while the interface said otherwise. If Dropbox rejects that
   * form, the access token is tried as a fallback.
   */
  async disconnect() {
    const attempts = [store.refresh, store.access?.token].filter(Boolean);

    for (const token of attempts) {
      try {
        const res = await fetch(RPC_HOST + 'auth/token/revoke', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) break;
      } catch {
        // Offline or already invalid: local sign-out still applies.
      }
    }

    signOut();
  }
}
