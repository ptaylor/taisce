# Implementation plan — Taisce

> **Read this with:** [`REQUIREMENTS.md`](./REQUIREMENTS.md) (scope, authoritative),
> [`AGENTS.md`](./AGENTS.md) (conventions), [`POC.md`](./POC.md) (what already
> worked and what it cost to learn).
>
> Priorities in this plan are the ones in `REQUIREMENTS.md`: unmarked = **P1**,
> then **P2**, **P3**, **P4**.

## 0. The two answers the requirements ask for

### 0.1 Dropbox — the redirect URI to add

The App Console has `http://localhost:8080/`. Add exactly one more, in
**Settings → OAuth 2 → Redirect URIs**:

```text
https://ptaylor.github.io/taisce/
```

Rules that make this work or fail:

- **Exact match, trailing slash included.** Dropbox compares the string it is
  given with the registered list; `https://ptaylor.github.io/taisce` (no slash)
  and `…/taisce/index.html` are different URIs. The app computes the redirect as
  `location.origin + location.pathname`, which is `https://ptaylor.github.io/taisce/`
  when served from Pages and `http://localhost:8080/` from the local server.
- **HTTPS except localhost.** Dropbox refuses plain `http://` for anything except
  `localhost`. Testing on a phone over a LAN address therefore needs a tunnel
  (`cloudflared tunnel --url http://localhost:8080`, gives you an `https://…`
  origin that must *also* be registered) or a self-signed cert with the phone
  trusting it. This is the single most common way the first phone test fails.
- **Each origin needs its own entry.** Tokens do not carry between origins, so a
  tunnel URL is a fresh sign-in, not a continued session.
- Add the deployed URI now, before the site exists — Pages can be enabled later
  and the URI is already valid.

### 0.2 Dropbox — other settings that are needed

| Setting | Value | Why |
| --- | --- | --- |
| Access type | **App folder**, folder name `Taisce` | Already set. The app can only ever see `/Apps/Taisce`; that is the privacy claim in the README. Do not switch to Full Dropbox. |
| Permissions | `account_info.read`, `files.metadata.read`, `files.content.read`, `files.content.write` | Already set. All four are used: the account name for the signed-in chip, metadata for listing, content read/write for open and save. |
| OAuth flow | **PKCE**, no app secret | A static site cannot keep a secret. Do not enable "Allow implicit grant"; PKCE is the supported public-client flow. |
| Branding | 64×64 and 256×256 icons | From the icon phase (P1). Dropbox's branding rules forbid their own logo in the mark. |
| App name | `Taisce` | Shown on the consent screen. |

## 1. Decisions this plan takes

These are the design choices the requirements leave open, recorded here so they
can be argued with once rather than re-litigated per commit.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Pseudo-WYSIWYG, block-based, no required toolbar** | Rendered Markdown by default; tapping a block puts the caret in *that block's* source; leaving the block re-renders it. Typing `## `, `**…**`, `` `…` ``, `- [ ] ` works exactly as typed — the syntax is the toolbar. Matches the requirement's "keep the clear rendered output" and the stated preference for no toolbars. |
| D2 | **The file is the source of truth, byte-for-byte** | A block model that keeps each block's **exact source span**; editing a block replaces only its span and everything else is untouched. No re-serialisation from an AST, so no diffs full of whitespace churn, and files stay readable in any other editor. |
| D3 | **Markdown rendering: vendored `marked` (ESM) + `DOMPurify`** | MIT/ Apache-2.0 respectively, both ship a single-file ES module, so vendoring preserves the no-build rule. Sanitising matters: a shared Dropbox folder can contain a file someone else wrote. Versions pinned in `vendor/`, recorded in `AGENTS.md`, licence texts committed. |
| D4 | **Autosave, no Save/Cancel** | Requirement. Debounced ~700 ms, plus blur, `visibilitychange` and `pagehide`; serialised so two uploads never race; `rev`-checked so two devices cannot silently overwrite each other. The POC's engine is the reference (`POC.md` §"The save engine"). |
| D5 | **Files are `.md`; the extension is a display detail** | Listing hides `.md` for top-level files. The path Dropbox sees always has the extension. |
| D6 | **P1 lists only top-level `.md` files; the data model is path-based from day one** | Requirement is top-level for P1, but P2 adds folders. Every function takes a full Dropbox path, never a bare name, so P2 is a UI change, not a rewrite. |
| D7 | **PWA shell is network-first; caches bump with a version constant** | Content must never be served stale; the shell still works offline. Editing shell files without bumping the cache name leaves installed devices on the old shell. |
| D8 | **Two halves: `publish.sh` publishes, GitHub Pages deploys** | The script increments the version on `main`, commits and tags it, pushes `main`, and pushes a fixed whitelist to `public`. Pages then serves `public` through its own pre-configured pipeline (the Actions behind *Deploy from a branch*) — this repository authors **no workflow**. Same script shape as `../gealach/publish.sh`. |
| D9 | **No backend, ever** | Static site + Dropbox API from the browser. Anything requiring a server is out of scope; say so instead of quietly adding one. |
| D10 | **Settings live in `localStorage`** | Recent-files count (P3), undo depth (P4), last-opened path. No Settings screen is required by the current requirements; the two configurable numbers get a small preferences sheet when their feature lands. |

### 1.1 Scope note — dropped from the previous requirements draft

The earlier draft asked for colour themes, a "strikethrough for done" setting,
and separate **Logout** and **Disconnect** actions. The current
`REQUIREMENTS.md` does not mention any of them. They are treated as **out of
scope** here. Task lists are rendered from Markdown checkboxes and ticked in
place, which covers the useful half of the strikethrough idea; a Disconnect
action still exists because a token you cannot revoke is a liability (see §6,
P1-M6). Say so if the colour setting should come back — it is cheap while the
palette is still one CSS block.

### 1.2 Deployment wording

The requirements separate two things that are easy to blur: the **script** does
versioning, tagging and pushing to `public`; the **deployment to the endpoint**
is GitHub Pages serving that branch through its own pre-configured Actions. The
repository therefore authors no workflow, and a `pages` workflow added later
would be a second deployment path competing with the one in settings.

`AGENTS.md`, `README.md` and `POC.md` described this as "published by GitHub
Actions", which named the mechanism but hid who does what. They now state the
two halves explicitly, and `publish.sh` (P1-M6) must match them.

## 2. Target architecture

```text
index.html               app shell: header, screens, dialogs
styles.css               tokens (--bg, --fg, --accent, …) + layout
app.js                   wiring only: boot, route, event delegation
js/config.js             app key, redirect URI, constants
js/auth.js               PKCE, token store, refresh, revoke          (POC lift)
js/dropbox.js            list / download / upload / create, errors  (POC lift)
js/save.js               debounce, serialise, rev conflict merge     (POC lift)
js/markdown.js           marked + DOMPurify wrapper, render(block)
js/blocks.js             Markdown → source-preserving blocks, round-trip
js/editor.js             block focus/blur, caret, list continuation, checkbox ticks
js/history.js            undo stack (P4)
js/files.js              list model, recents, search (P3)
js/ui.js                 screens, toast, dialogs, status line
js/mock.js               fake provider for ?mock=1 and tests
vendor/marked.esm.js     pinned, licence alongside
vendor/dompurify.es.mjs  pinned, licence alongside
manifest.webmanifest
sw.js
icons/                   icon.svg + 64/192/256/512/maskable/apple-touch
docs/index.html          documentation page (P3)
tools/serve.py           local HTTPS dev server (only if phone testing needs it)
publish.sh               version bump, tag, push main + public
test/*.test.js           node --test
```

**The provider seam stays.** `listTxt`/`download`/`upload`/`create` — generalised
to `list(dir)`/`read(path)`/`write(path, text, rev)`/`create(path, text)`
(`POC.md` §Architecture). This is what makes `?mock=1`, the tests and a future
"copy to another service" all cheap.

**Where the logic lives:** pure functions in `blocks.js`, `markdown.js`,
`save.js`, `files.js`, `history.js`; DOM only in `editor.js`, `ui.js`, `app.js`.
That split is what `node --test` can actually test.

## 3. Phase P1 — the first release

Exit criterion: **open the deployed URL on a phone, sign in to Dropbox, see your
Markdown files, open one rendered, tick a task item, tap a paragraph, type `## `
at the start, and watch both changes land in Dropbox within a second — with no
Save button, and no data loss if the same file is opened on a laptop.**

### P1-M1 — Shell, configuration, mock mode

- `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js` with relative URLs
  only — the site is served from the `/taisce/` sub-path, so a leading
  `/` works locally and breaks in production.
- `js/config.js` with the app key; empty key ⇒ setup checklist instead of a
  broken Connect button.
- Three screens: auth / list / file. Status line ("Saved 12:04:05").
- `?mock=1` provider with sample Markdown, so every later milestone is testable
  without an account.
- `python3 -m http.server 8080` is the default local server. **8080 is not a
  preference** — it is the only local port registered as a Dropbox redirect URI,
  so a server on any other port cannot complete sign-in.

**Done when:** the shell loads, the manifest parses, the service worker
registers on localhost, and mock mode lists sample files.

### P1-M2 — Auth (PKCE) and the file list

- `js/auth.js`: verifier + S256 challenge, `state`, `token_access_type=offline`,
  `redirect_uri = origin + pathname`, code exchange with no secret, refresh with
  60 s skew, `invalid_grant` ⇒ clear and re-prompt. Lift the flow from
  `POC.md` §Authorisation rather than re-deriving it.
- `js/dropbox.js`: `files/list_folder` for the App-folder root, non-recursive,
  `.md` only, `path_lower` for paths, `.md` stripped for display, sorted by name.
- Error states: expired session → auth screen; folder empty → "create one" CTA.

**Done when:** a real account signs in, the list shows top-level Markdown files
without extensions, and a reload keeps the session without a second consent.

### P1-M3 — Read, render, edit, autosave

The core, and the largest milestone. Order matters, because each step is only
safe once the previous one is.

1. **Read + render.** `files/download`; metadata from the `Dropbox-API-Result`
   response header (fall back to `files/get_metadata`). Render through
   `marked` → `DOMPurify` into the page. Support: headings, bold/italic/
   strikethrough, inline code, fenced code, bullet/numbered/task lists, links,
   blockquotes, rules, tables, images. Links open in a new tab with
   `rel="noopener noreferrer"`.
2. **Blocks.** Parse the source into blocks with exact character spans: heading,
   paragraph, list (consecutive items, one block), fenced code, blockquote,
   table, rule, image. Round-trip property: `serialise(parse(src)) === src`.
   **This is the first test file.**
3. **Block editing (D1).** Rendered blocks are `contenteditable="false"`.
   Tap/click focuses a block → it shows its source in a styled `<textarea>` sized
   to content; `Esc` or focus leaving re-renders it. No toolbar. `Enter` starts a
   new block inheriting the current marker (`- `, `1. `, `> `, `- [ ] `);
   `Backspace` at the start of an empty block joins it to the previous one.
4. **Task ticking (explicit requirement).** A rendered task checkbox toggles
   `- [ ]` ⇄ `- [x]` in the source and saves — **without entering edit mode**, on
   click and on touch. The box gets a ≥44 px hit area and swallows the tap, so
   it does not also focus the block; the tick survives the re-render. Ticking is
   an edit like any other and goes through the same save engine, so two devices
   cannot fight over it.
5. **Save engine.** Lift `save.js` from the POC: 700 ms debounce, single chain,
   clean-only-if-still-identical, one 409 retry through a merge that re-applies
   edited *spans* (the POC merged by line index; with blocks, merge by block
   identity and fall back to "remote wins, tell the user" when structure
   changed).
6. **Unsaved-work guard.** `visibilitychange`/`pagehide` flush; a save failure
   keeps the buffer and says so — never silently drop text.

**Done when:** editing a heading inline by typing `## ` updates Dropbox; **a
tick on a task item changes the file from the rendered view, on a phone, without
opening an editor**; a file edited in the app and in a text editor converges
(either a clean merge or an honest "reloaded from Dropbox" message); a 300-line
file renders without jank; no dirty buffer survives a backgrounded tab.

### P1-M4 — New file, icons, docs-in-app (minimal)

- `+` creates a `.md` file: name validation (no `/`, no `\`), `.md` appended,
  `mode: { '.tag': 'add' }` so an existing name is an error, not an overwrite.
- `icons/icon.svg` as the single source; rasterise to 64, 192, 256, 512,
  maskable-512 and apple-touch; favicon from the SVG; README uses it. **One
  commit for all of them** (`AGENTS.md` rule). Dropbox gets 64 and 256.
- Minimal in-app help (what to type, how to install on iOS/Android). The full
  documentation *page* is P3 — P1 only needs enough that a first-time user is
  not stuck.

**Done when:** the icon appears as favicon, home-screen icon and App Console
branding, and a new file can be created and typed into immediately.

### P1-M5 — Tests

`node --test`, no dependencies:

- `blocks`: round-trip on fixtures (headings, nested lists, task lists, fenced
  code containing Markdown, tables, CRLF input, BOM, no trailing newline); and
  that toggling a task flips exactly the marker — indent, `[x]` state and item
  text untouched, and nothing else in the document changes.
- `save`: fake provider — concurrent edits, 409 merge, conflicted structure,
  auth expiry mid-save.
- `markdown`: each required feature renders; a `<script>`/`onerror` payload is
  neutralised.
- `auth`: PKCE challenge/verifier helpers and `redirect_uri` construction.

**Done when:** `npm test` passes from a clean clone with no `node_modules`.

### P1-M6 — Disconnect, deployment, first real release

- Disconnect: revoke at Dropbox (`auth/token/revoke`) then forget tokens
  locally; confirm first; files untouched.
- `publish.sh` (D8): refuses a dirty tree, bumps the version in the meta tag and
  the service-worker cache name, commits the bump, tags `vX.Y`, pushes `main` +
  tag, then publishes a **whitelist** (`index.html`, `styles.css`, `app.js`,
  `js/`, `vendor/`, `icons/`, `manifest.webmanifest`, `sw.js`, `docs/`) to
  `public` through a throwaway index — so `test/`, `tools/` and `.github/` can
  never be fetched from the site. `--no-push` prints what it would do.
- Point GitHub Pages at `public` /(root) once; from then on Pages deploys each
  push to `public` itself. First deploy, then **verify the deployed URL** —
  relative URLs, manifest, service worker and the redirect URI all behave
  differently under `/taisce/` than on localhost.
- Keep `publish.sh` and the docs describing the same two halves (§1.2): the
  script publishes, Pages deploys, no workflow is authored here.

**Done when:** `./publish.sh --no-push` prints the next version, a real run
produces `v1.0` and a live site, and the phone signs in from the deployed origin.

## 4. Phase P2 — directories

- List folders as well as files at the current level; folders first, then files.
- Navigate down into a folder; navigate up; breadcrumb in the header; back
  returns to the parent rather than the root.
- Create a folder with the same `+` affordance; nested creation allowed.
- Files inside folders keep the same display rule (hide `.md`).
- Paths are `path_lower` throughout; display uses `path_display`.
- The save model does not change: a folder is just a longer path.

**Watch out:** `files/list_folder` pagination (`cursor`/`has_more`) is the first
thing that silently truncates a real Dropbox. `files/create_folder_v2` returns
a conflict if the name exists. Deleting and renaming are **not** in scope.

**Done when:** you can create `notes/2026/october.md` from inside the app, leave
it, come back through the breadcrumb, and open it.

## 5. Phase P3 — recents, search, documentation page

- **Recent files**: a `localStorage` ring of `{ path, at }` updated on open and
  on save; count configurable (default 8) in a small preferences sheet; shown
  above the list when at the root. Validate entries against the live listing so
  deleted or renamed files vanish from recents instead of erroring on tap.
- **Search**: filename substring, case-insensitive, across the whole app folder
  (`list_folder` with `recursive: true`, cached per session, invalidated on
  write). Debounced input; results show folder + name.
- **Documentation page**: `docs/index.html`, same styling, published in the
  whitelist. What the app is, the Markdown you can type, keyboard/shortcuts,
  install instructions per platform. Achievable in one sitting — resist scope
  creep.

**Done when:** recents survive a reload, search finds a nested file by name, and
the docs page is reachable from the deployed site and from the app.

## 6. Phase P4 — undo, image paste

- **Undo**: an explicit history stack of block-span replacements, not the
  browser's per-textarea undo (which is lost the moment a block re-renders).
  Depth configurable (default 50), `Ctrl/Cmd+Z` and `Shift+Ctrl/Cmd+Z`; the
  stack is cleared on file change and after a remote reload is adopted.
- **Paste image**: on paste with `image/*` in the clipboard, upload to an
  `assets/` sibling of the current file (creating the folder if missing),
  name it deterministically (`2026-10-31-120405.png` plus a slug if the browser
  gives a filename), then insert `![](./assets/…)` at the caret. Upload first,
  link second — a link to a failed upload is worse than no link. Show progress;
  the Dropbox write is a separate request from the note's save.
- Also consider a lightweight **syntax highlight** for fenced code (highlight.js
  ESM is ~large; decide at the time whether it earns its place, per
  `AGENTS.md`).

**Done when:** undo restores the exact pre-edit source and survives block
re-renders; a pasted screenshot appears as a real file in the folder and renders
in the note on another device.

## 7. Risks, and the trap each one springs

| Risk | Mitigation |
| --- | --- |
| Redirect URI mismatch on the deployed site | Register both URIs before M2; assert the computed URI on a failed sign-in and show it in the error, exactly as the POC's setup screen does. |
| Losing an edit on a phone | Dirty-buffer guard + `pagehide` flush + "save failed, text kept" state. Test by backgrounding the app mid-edit. |
| Accidental edits while scrolling | A block enters edit only on a deliberate tap/keyboard focus, never on scroll-settling; if that still fires on a real phone, require a second tap and measure it rather than guessing. |
| Two devices overwriting each other | `rev` + `strict_conflict`; never fall back to `overwrite` to make a 409 disappear. |
| Markdown re-serialisation reformatting the file | D2's span-preserving blocks and the round-trip test. This is the risk most likely to be introduced by a well-meaning refactor. |
| XSS from a file written elsewhere | Sanitise every render; never `innerHTML` raw content; test with a payload fixture. |
| Token in `localStorage` | Accept for personal use; strict CSP, no third-party scripts, no analytics; document the limit honestly (as the POC does). |
| Stale shell on installed devices | Cache name bumped by `publish.sh`; network-first fetches. |
| Phone testing blocked by HTTPS | Tunnel (`cloudflared`) or the POC's self-signed `serve.py`; register the resulting origin if used for more than a session. |
| Whole-file upload on every save | Accept for notes; show a clear error rather than hanging on very large files; measure at ~1 MB before P4. |
| Scope creep from "most common Markdown features" | The P1-M3 list is the contract; anything else is a later commit with a reason. |

## 8. Definition of done, per phase

Every phase ends with:

1. `npm test` green (from M5 onward), plus the checks in the phase's "Done
   when".
2. A manual pass on desktop Chrome/Safari and one phone, against a real Dropbox
   account (not only mock mode).
3. `AGENTS.md` updated in the same commit if a language, library, dependency or
   command changed — including the vendored library versions and licences.
4. `.gitignore` updated in the same commit if anything new is generated.
5. The deployed site exercised, not just localhost, for anything that touches
   paths, the manifest, the service worker or auth.
6. Commit messages: imperative subject, body explaining why, `Assisted-by:`
   trailer naming the assistant and model.

## 9. Still open (not blocking P1)

- **Offline writes** — not required; the plan errors and keeps the buffer. A
  queue is a later decision, and a real one (it needs conflict semantics for
  edits made offline).
- **Colour themes and Disconnect-vs-Logout** — dropped from the current
  requirements; see the scope note in §1. Confirm if they should return.
- **Custom domain** — would need its own redirect URI and a Pages CNAME.
- **`Name` / `Description` headings** at the top of `REQUIREMENTS.md` are still
  empty. The plan assumes the name is *Taisce* and the description is the one in
  the README.

---

Written with an AI coding assistant.
Assisted-by: GitHub Copilot (DeepSeek V4 Flash)
