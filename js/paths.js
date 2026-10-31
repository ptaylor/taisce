// Dropbox paths are absolute and have no trailing slash. Every function here
// returns that canonical shape so navigation cannot invent a path that Dropbox
// will not resolve.
export function normaliseDir(path) {
  if (!path || path === '/') return '';
  let value = String(path).trim();
  if (!value.startsWith('/')) value = `/${value}`;
  return value.replace(/\/+$/, '');
}

export function parentDir(path) {
  const value = normaliseDir(path);
  if (!value) return '';
  const cut = value.lastIndexOf('/');
  return cut <= 0 ? '' : value.slice(0, cut);
}

export function baseName(path) {
  const value = normaliseDir(path);
  return value.slice(value.lastIndexOf('/') + 1);
}

export function joinPath(dir, name) {
  const parent = normaliseDir(dir);
  const child = String(name).replace(/^\/+/, '');
  return parent ? `${parent}/${child}` : `/${child}`;
}

export function breadcrumbs(path, rootLabel = 'Taisce') {
  const value = normaliseDir(path);
  const parts = value ? value.slice(1).split('/') : [];
  const crumbs = [{ label: rootLabel, path: '' }];

  let walked = '';
  for (const part of parts) {
    walked += `/${part}`;
    crumbs.push({ label: part, path: walked });
  }
  return crumbs;
}
