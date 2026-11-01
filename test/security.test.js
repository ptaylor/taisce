import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the app ships a Content-Security-Policy that blocks injected script', () => {
  const html = read('index.html');
  const match = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);

  assert.ok(match, 'index.html must carry a meta CSP');
  const csp = match[1];
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /connect-src [^;]*api\.dropboxapi\.com/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
});

test('the published pages carry a policy too', () => {
  for (const page of ['docs/index.html', 'docs/privacy.html']) {
    assert.match(read(page), /http-equiv="Content-Security-Policy"/, page);
  }
});

test('no inline script blocks are left in the shell', () => {
  const html = read('index.html');
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  // Every script is external: an inline block would need 'unsafe-inline' in
  // script-src, which is the thing the policy exists to avoid.
  for (const attrs of scripts) {
    assert.match(attrs, /src=/, `a script tag without src: ${attrs}`);
  }
  // The app is a module; the vendored GoatCounter counter is a classic script
  // because count.js is written as one, and it comes from this origin.
  assert.match(html, /<script[^>]*type="module"[^>]*src="\.\/app\.js"/);
  assert.match(html, /<script[^>]*src="\.\/vendor\/count\.js"/);
  assert.doesNotMatch(html, /script[^>]*src="(?:https?:)?\/\//);
});

test('the sanitizer strips attributes that reach the network or shadow ids', () => {
  const source = read('js/markdown.js');
  assert.match(source, /FORBID_ATTR:\s*\[[^\]]*'style'/);
  assert.match(source, /FORBID_ATTR:\s*\[[^\]]*'id'/);
  assert.match(source, /FORBID_ATTR:\s*\[[^\]]*'name'/);
});

test('remote images are sandboxed before the markup is inserted', () => {
  const source = read('js/editor.js');
  assert.match(source, /sandboxHtml\(renderMarkdown\(/);
  assert.match(source, /classList|className = 'remote-image'/);
});

test('the vendored sanitizer is at or above the mXSS fix', () => {
  const banner = read('vendor/purify.es.mjs').split('\n', 1)[0];
  const version = banner.match(/DOMPurify (\d+)\.(\d+)\.(\d+)/);
  assert.ok(version, 'version banner not found');

  const [major, minor, patch] = version.slice(1).map(Number);
  const atLeast = (a, b, c) =>
    major > a || (major === a && (minor > b || (minor === b && patch >= c)));

  // GHSA-h8r8-wccr-v5f2 and GHSA-v2wj-7wpq-c8vv were fixed in 3.3.2.
  assert.ok(atLeast(3, 3, 2), `DOMPurify ${version[0]} is below the fixed floor`);
});

test('publishing is restricted to main', () => {
  const script = read('publish.sh');
  assert.match(script, /BRANCH=.*rev-parse --abbrev-ref HEAD/);
  assert.match(script, /"\$BRANCH" != "main"/);
  assert.match(script, /git push origin "\$BRANCH"/);
});
