import test from 'node:test';
import assert from 'node:assert/strict';

import { b64url, challengeFor, redirectUri } from '../js/auth.js';

test('b64url is url-safe and unpadded', () => {
  const encoded = b64url(new Uint8Array([251, 255, 191, 0]));
  assert.doesNotMatch(encoded, /[+/=]/);
  assert.equal(encoded, '-_-_AA');
});

test('challengeFor produces the S256 challenge Dropbox expects', async () => {
  const verifier = 'abcdefghijklmnopqrstuvwxyz0123456789-._~abc';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  assert.equal(await challengeFor(verifier), b64url(digest));
});

test('redirectUri is origin plus pathname, trailing slash included', () => {
  assert.equal(
    redirectUri({ origin: 'https://ptaylor.github.io', pathname: '/taisce/' }),
    'https://ptaylor.github.io/taisce/',
  );
  assert.equal(redirectUri({ origin: 'http://localhost:8080', pathname: '/' }), 'http://localhost:8080/');
});
