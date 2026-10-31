# POC — the Dropbox text editor that already works

> **What this is.** A working proof of concept, written before Taisce had a
> repository, now kept as reference material. It is not Taisce, it is not a
> dependency of Taisce, and none of its code has been copied into this
> repository. This document records what it proved, how it did it, and what it
> got wrong — so the plan can reuse the working parts and skip the traps.
>
> **Where it lives:** `/Users/paul/bitbucket/pftylr/projects/dropbox/pwa/`
> (Bitbucket: `pftylr/projects`, `dropbox/`). ~2,000 lines, dependency-free,
> vanilla JS. The Dropbox app it was built against is *not* the Taisce app:
> it uses app key `mismrdoqcgpls0t` and an App folder named `Buail`.

## What the POC proved

All of the following are implemented, and the POC's own README documents them as
working against a real Dropbox account, on a desktop browser and on an iOS
home-screen install:

- **OAuth with PKCE from a pure static page** — no backend, no client secret, a
  refresh token that survives reloads. This is the single most important result:
  the architecture in `README.md` is viable.
- **Listing and filtering** files in the app's folder, including nested ones,
  with pagination.
- **Reading and writing a file** with a real conflict check (`rev`), including
  detecting and handling a 409 when the same file changed elsewhere.
- **Editing on a phone** — line-per-`textarea` editor with checkboxes for task
  lists, Enter to start the next item, Backspace to drop an empty one,
  multi-line paste split into items.
- **Auto-save** that is invisible in normal use: 0.7 s after typing stops, on
  blur, when the app is backgrounded, and on `pagehide`.
- **A UI-only demo mode** (`?mock=1`) with a fake in-browser backend, so the
  whole interface can be developed and shown without a Dropbox account.
- **Installability**: manifest, service worker, icons including the 64×64 and
  256×256 that Dropbox's App Console wants for app branding.

What it did **not** prove: deployment (there is no CI and nothing in the project
is configured to publish; it only ever ran from the local server), offline
writing, more than three file formats, any settings screen — and it has **no
tests at all**.

## Architecture of the POC

| File | Lines | Role |
| --- | --- | --- |
| `pwa/app.js` | 1030 | Everything: PKCE auth, both providers, editor, save engine, view. One IIFE, section-commented. |
| `pwa/index.html` | 119 | Three `<section>` screens (auth / list / file) plus two `<dialog>` sheets. |
| `pwa/styles.css` | 502 | Dark theme from ten CSS custom properties; line rows, safe-area padding, sheets. |
| `pwa/config.js` | 11 | `window.APP_CONFIG = { appKey, rootPath, recursive }`. |
| `pwa/sw.js` | 53 | Network-first service worker with a cache fallback and a version constant. |
| `pwa/manifest.webmanifest` | 16 | Standalone, portrait, dark. |
| `pwa/serve.py` | 165 | Dev server: `--https` with a self-signed cert, no-store headers, prints LAN URLs. |
| `pwa/icons/` | — | `icon.svg` source plus 64/192/256/512/1024/maskable/apple-touch PNGs. |
| `pwa/README.md` | 126 | The POC's own notes — still the best description of its limits. |

The shape is a **provider interface** with two implementations:

- `DropboxProvider` — real API.
- `MockProvider` — same methods, `localStorage`-backed under `mock.files.v1`,
  ~120 ms latency, fake `r1`/`r2` revisions so conflict handling can be tested.

Methods: `listTxt()`, `download(path)`, `upload(path, text, rev)`,
`create(path, text)`, `disconnect()`. That is the whole backend contract, and it
is a good one to keep: it is what makes the mock mode possible and what the
tests can stub.

### Screens and state

A single `state` object drives everything: `screen`, `provider`, `files`,
`file`, `mode`, `lines`, `rev`, `savedText`, `edited` (set of line indexes),
`structure` (true when lines were added/removed), `rendered` (for chunked
rendering), `saveTimer`, `chain` (save serialisation).

## Dropbox integration, precisely

This is the part worth copying exactly, because it was arrived at by debugging.

### Authorisation

```text
https://www.dropbox.com/oauth2/authorize
  ?client_id=<appKey>
  &response_type=code
  &code_challenge=<S256 of verifier>
  &code_challenge_method=S256
  &token_access_type=offline
  &redirect_uri=<location.origin + location.pathname>
  &state=<random>
```

- Verifier: 32 random bytes, base64url (`crypto.getRandomValues`), challenge via
  `crypto.subtle.digest('SHA-256', …)`.
- `state` is checked on return, and the code is stripped from the URL with
  `history.replaceState` before anything else runs.
- The verifier and state are written to **both** `localStorage` and
  `sessionStorage`, because the redirect back from Dropbox is a new page load and
  one of the two can be missing in some browser/private-mode combinations.
- Token exchange: `POST https://api.dropboxapi.com/oauth2/token` with
  `grant_type=authorization_code`, `code`, `client_id`, `code_verifier`,
  `redirect_uri` — **no secret**. `refresh_token` comes back because of
  `token_access_type=offline`.
- Recovery from a revoked grant: if the refresh call returns
  `error=invalid_grant`, clear both stored tokens and send the user back to the
  connect screen rather than retrying forever.

### Token handling

| Key | Contents |
| --- | --- |
| `dbx.refresh` | The long-lived refresh token. |
| `dbx.access` | JSON `{ token, expires }` — access token cached with its expiry. |

`token()` returns the cached access token when it has more than 60 s left,
otherwise refreshes. `expires_in` is defaulted to 14400 if absent.

### Calls

Two shapes, and getting the host right matters:

```text
RPC     POST https://api.dropboxapi.com/2/<endpoint>
          Authorization: Bearer <token>
          Content-Type: application/json
          body: <arguments>

Content POST https://content.dropboxapi.com/2/<endpoint>
          Authorization: Bearer <token>
          Dropbox-API-Arg: <arguments as JSON>
          Content-Type: application/octet-stream
          body: <bytes>
```

| Purpose | Call | Notes |
| --- | --- | --- |
| List | `files/list_folder` | `{ path: root, recursive, limit: 2000 }`, then `files/list_folder/continue` with `cursor` while `has_more`. |
| Read | `files/download` | Metadata comes back in the **`Dropbox-API-Result` response header** (CORS-exposed); `files/get_metadata` is the fallback if a proxy strips it. |
| Write | `files/upload` | `mode: { '.tag': 'update', update: rev }`, `autorename: false`, `mute: true`, `strict_conflict: true`. Returns the new `rev`. |
| Create | `files/upload` | `mode: { '.tag': 'add' }` — fails instead of overwriting. |
| Revoke | `auth/token/revoke` | Called on disconnect, before forgetting the tokens locally. |

Error mapping is deliberate and worth preserving:

- **401** → `AuthError`: drop the *access* token (keep the refresh token, try
  once more), then show the auth screen if it persists.
- **409** → `ConflictError`: the file changed underneath; go to the merge path.
- **429** → a plain error saying "rate limited — try again shortly".
- Everything else → `error_description` / `error_summary` surfaced as the message.

Paths are compared and stored as `path_lower`; `path_display` is only used to
strip the root prefix for display. The root is `''` for an App-folder app.

## The editor model

Files are plain `.txt`; the *type* is a rendering convention stored per path in
`localStorage` under `filemodes`, chosen at creation and re-detected on open if
unknown:

| Type | Line shape | Editor |
| --- | --- | --- |
| text | anything | free-form line |
| list | `- item` | bullet glyph, text without marker |
| tasks | `- [ ] item` / `- [x] item` | real checkbox, tap to tick |

`detectMode` only claims `list`/`tasks` when **every** non-empty line matches, so
a mixed file opens as plain text rather than being mangled. Each line keeps a
`rebuild` closure that re-applies its original prefix/suffix, so editing the
visible text never disturbs the marker.

Rendering is chunked at 300 rows with a "Load more" button, and each row is a
one-line `textarea` auto-sized to its content via `scrollHeight`.

Key handling: `Enter` inserts the mode's seed — `- [ ] ` for tasks, `- ` for
lists, nothing for text — and focuses the new line; `Backspace` on an empty line
removes it; a multi-line paste is split, with the marker added to the middle
lines in list/tasks modes. `normalise()` strips a BOM and converts CRLF to LF on
open.

## The save engine — the part that deserves the closest reading

The naive version of this loses edits. The POC's version does not, and the
reason is the ordering:

1. Every mutation marks the line in `edited` and starts/restarts a **700 ms**
   debounce.
2. `save()` clears the timer and serialises through a single `state.chain`
   promise, so two uploads can never be in flight at once.
3. `performSave()` loops up to 5 times, uploading `lines.join('\n')` while it
   differs from `savedText`.
4. After a successful upload, it only marks the editor clean if the content is
   *still* identical — typing during the upload keeps it dirty.
5. A 409 is retried **once** through `mergeConflict()`:
   - re-download the file, adopt the new `rev`;
   - if lines were added/removed (`state.structure`) or the line counts differ,
     **remote wins**: the local edits are dropped and a toast says so;
   - otherwise, re-apply only the locally edited line indexes onto the remote
     text — a cheap three-way merge that works because edits are line-indexed.

Save triggers: debounce, `blur` on a line, `visibilitychange` → hidden, and
`pagehide`. Opening another file or going back calls `flush()` first.

## Known POC limits (its own README, plus what the code shows)

- **Tokens in `localStorage`.** A long-lived, unrotated refresh token is one XSS
  away from full Dropbox access. Acceptable for personal use behind a strict
  CSP; a shared deployment would want the token exchange behind a small backend.
- **"Disconnect" revokes; there is no "Logout".** The requirement file lists both
  — see the gaps table below.
- **No offline write queue.** A save while offline errors and retries on the next
  edit. Only the shell is cached, never file content.
- **Conflict merge drops edits** whenever line counts changed. It is honest about
  it (a toast), but it does lose work.
- **CRLF normalised to LF** on first save.
- **Whole-file re-upload on every save**, so it is fine for notes and bad for a
  megabyte log.
- **Type lives only in `localStorage`** — the same file opened on another device
  is re-detected, and a list whose first line is prose becomes plain text. If
  Taisce's six formats must survive a device change, the type has to live in the
  file or the path.
- **No rename, delete, search, sort, or folder navigation.** A flat list of
  `.txt` paths.
- **No tests, no CI, nothing deployed.**
- Service worker is **network-first**; the POC's README warns that editing shell
  files requires bumping `CACHE` in `sw.js`.

## Gaps against this repository's `REQUIREMENTS.md`

| Requirement | POC state | What the plan has to decide or build |
| --- | --- | --- |
| List | ✔ tasks/lists | — |
| Numbered List | ✘ | A numbered variant of the list mode; renumbering on insert/delete. |
| Task List | ✔ | Add the settings-driven strikethrough (currently an unconditional `.done` style). |
| Free Form | ✔ (`text`) | — |
| Markdown | ✘ | Render/preview, or edit-as-text with a preview toggle. Decide whether checkboxes render as real tasks. |
| Spec | ✘ (nothing defined) | Define what "spec" means as a template/structure before coding it. |
| Copy / Paste | ~ | Multi-line paste is handled; there is no explicit copy affordance (copy the file, copy a line, copy as Markdown?). |
| Colours setting | ✘ | The palette is already ten CSS custom properties in `:root`; a theme picker writes those. Also drives manifest `theme_color`. |
| Strikethrough for done | ~ hard-coded | Make it a setting. |
| Logout | ✘ | "Logout" (forget tokens locally, keep the Dropbox grant) vs "Disconnect" (revoke, as the POC does). Confirm the intended difference. |
| Icons 64×64, 256×256, README, favicon | ✔ sizes, ✘ artwork | The POC's icon pipeline and file set are exactly right; the mark is "Buail" branded and needs replacing with a Taisce mark. |
| App website with instructions | ✘ | A separate static page (marketing + install + how to use), published with the app. |
| PWA at `/taisce/`, GitHub Actions → `public` | ✘ | No CI exists. The POC only ever ran locally. Everything must stay relative because of the sub-path. |
| Dropbox app "Taisce" (`be0wdpfwojgf4p3`) | Different app | Register the two redirect URIs for the new app; decide App folder vs Full Dropbox; confirm scopes. The POC's App-folder choice is the privacy-preserving default. |

## Traps this POC already paid for

1. **`config.js` is the only hard-coded app key.** Empty key ⇒ a setup checklist
   screen instead of a broken connect button. Keep that behaviour.
2. **Redirect URI = `origin + pathname`,** and Dropbox demands an exact match,
   including the trailing slash. Every origin needs its own registration —
   `http://localhost:8080/`, `https://<lan-ip>:8443/` and the deployed
   `/taisce/` URL are three different entries.
3. **A phone needs HTTPS for the service worker *and* for the redirect.** The
   POC ships a self-signed cert generator and tells you to trust it on iOS; a
   tunnel (`cloudflared tunnel --url http://localhost:8080`) is the easier road.
4. **The metadata is in a response header,** not the body, on `files/download`.
5. **`strict_conflict` + `rev` is what makes two devices safe.** Do not fall back
   to `overwrite` to "make the 409 go away".
6. **Serialise saves.** Without `state.chain`, typing during an upload produces
   out-of-order writes and the last one wins arbitrarily.
7. **Only mark clean if the buffer still matches** what was uploaded.
8. **Bump the cache name** in `sw.js` when the shell changes, or installed
   devices keep the stale shell.
9. **`path_lower` for identity, `path_display` for humans.**
10. **Mock mode is not a toy.** `?mock=1` made every layout and editor change
    testable without touching an account, and it is the natural seam for tests.

## What to lift, adapt, or rewrite

| From the POC | Under Taisce | Action |
| --- | --- | --- |
| PKCE + token store + `token()` refresh | `js/dropbox.js` | **Lift**, split out of the IIFE, export pure helpers (`b64url`, `challengeFor`) so they can be unit-tested. |
| `DropboxProvider` calls and error mapping | `js/dropbox.js` | **Lift**, keeping the 401/409/429 mapping verbatim. |
| `MockProvider` | `js/mock.js` (test/dev only) | **Adapt** — same interface, no longer shipped in the production bundle path if that can be done without a build step. |
| Line parser (`TASK_RE`, `BULLET_RE`, `parseLine`, `detectMode`) | `js/formats.js` | **Lift and extend** for numbered lists, Markdown, spec. Pure functions — the obvious first test suite. |
| Save engine (`save`, `performSave`, `mergeConflict`) | `js/save.js` | **Lift**, parameterised by a provider. Highest-value tests in the project. |
| Editor rendering, key handling, paste | `js/editor.js` | **Adapt** — adds copy affordance and Markdown/Format views. |
| `sw.js`, manifest, icons, `index.html` shell | root / `icons/` | **Adapt** — new artwork, `theme_color` from settings, relative URLs everywhere. |
| `serve.py` | `tools/serve.py` or drop it | **Decide** — `python3 -m http.server` is enough on a laptop; the HTTPS-on-a-phone path is the only reason to keep it. |
| CSS tokens | `styles.css` | **Lift** the ten custom properties as the colour-setting surface. |

## Questions the plan must answer

1. **App folder or Full Dropbox?** App folder is the POC's default and is the
   privacy story in `README.md`; Full Dropbox needs a much better reason.
2. **What is a "Spec"?** It is the only requirement with no obvious precedent in
   the POC, and it should not be invented in code.
3. **Where does the file type live?** `localStorage` (POC) is per-device; a
   filename extension (`.md`, `.list`) or a first-line marker survives devices
   but pollutes the file. This is a one-way decision for users' files.
4. **Logout vs Disconnect** — what exactly does each do?
5. **Markdown: preview or just edit?** A preview means a renderer, which is the
   first dependency that might earn its place.
6. **Offline writes** — out of scope for the first milestone, or required?
7. **Conflict behaviour on a phone** — is losing local edits on a line-count
   change acceptable, or does the first release need a "keep mine / keep theirs"
   prompt?

---

Compiled from the POC source at `/Users/paul/bitbucket/pftylr/projects/dropbox/`
on 2026-10-31. This file was written with an AI coding assistant.
Assisted-by: GitHub Copilot (DeepSeek V4 Flash)
