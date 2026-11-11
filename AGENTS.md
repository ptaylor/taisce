# AGENTS.md

Instructions for any human or AI agent working in this repository.

## Summary

Taisce (*TAHSH-keh*, Irish for "hoard" or "store") is a browser app for reading
and editing Markdown files in the user's own Dropbox. It renders the file and
lets you edit it where you read it, with no Save button. It is a PWA served as a
static site from GitHub Pages — there is no server of ours, no database, and no
copy of anyone's files anywhere except their own Dropbox and their own browser.

`REQUIREMENTS.md` is the source of truth for **what** the app must do. This file
covers **how** the repository is worked on. When the two disagree about scope,
`REQUIREMENTS.md` wins; when they disagree about conventions, this file wins.

## Status

**All four phases implemented and published.** Sign-in (PKCE) with a
configurable age limit on the stored tokens, folders with
nesting and breadcrumb navigation, rendered Markdown, source-preserving in-place
editing with autosave, keyboard formatting (bold, italic, underline,
strikethrough), interactive task lists, new files and folders, renaming,
recent files, filename search, undo/redo with a configurable depth, pasted
images, background `.bak` backups when a note opens, sharing as PDF or Markdown
with background republishing of shared PDFs, the `docs/` guide, the icon set and
`publish.sh` all exist and are tested. The site is live at
<https://ptaylor.github.io/taisce/>; `./publish.sh` is what puts a new version
there.

Known gaps:

- No offline write queue: a save while offline errors and keeps the buffer.
- Images are fetched one by one with the user's token; there is no thumbnail or
  lazy-load strategy beyond object-URL caching for the session.
- Undo steps are per note and reset on reload, by design — they are a typing
  aid, not a version history.
- Backups are best-effort and invisible: a failure is logged, not shown, and the
  next open retries. The old copy is deleted before the new one is written, so a
  failed upload can leave no backup until then.
- Sharing a note defaults to a generated `note.pdf` beside it; Settings can
  switch to sharing the Markdown file itself. The PDF is text-only (pictures
  become their alt text), overwrites any existing file at that path, and is
  deleted with the note, so a public link cannot outlive what it points at.
- The Share button's republish dot reads a per-browser record. A PDF shared
  from another device is discovered on the next save, not when the note opens,
  so the dot can be absent until then; the background update itself still runs
  once that probe finds the link.

## Commands

A command appears here in the same commit that makes it work — never before,
because a documented command that fails is worse than a missing one.

```sh
python3 -m http.server 8080   # serve the app at http://localhost:8080
npm test                      # node --test, no runtime dependencies
./publish.sh --no-push        # show the next version, change nothing
./publish.sh                  # bump, tag, push main + tag + public
report/.venv/bin/python report/goatcounter-report.py --period "this month"
```

The report command needs a one-time venv and a `GOATCOUNTER_API_TOKEN` in
`.env.sh`; see [`report/README.md`](./report/README.md). It is development
tooling and is never served.

**8080 is not a preference** — it is the local port registered as a Dropbox
redirect URI, so a server on any other port cannot complete sign-in. Add
`?mock=1` to work on the UI with no account at all.

There is **no build step**. If a change makes one necessary, it has to earn its
place (see "Project rules"); the default is that what is committed is what is
served.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | The app shell: header, three screens, the new-file / confirm / help dialogs. |
| `app.js` | Wiring only: boot, screens, list, open, save engine hook-up. |
| `styles.css` | Design tokens (`--bg`, `--accent`, …) and layout. Light and dark. |
| `js/auth.js` | PKCE, the token store, refresh, sign-out, and the age limit on a stored sign-in. |
| `js/tokens.js` | The token-age setting and the rule for when a stored sign-in has expired. Pure. |
| `js/backup.js` | The background `.bak` writer: one write per note at a time, metadata before delete, failures only logged. |
| `js/dropbox.js` | The Dropbox API client: list (folders + files), read, metadata, write, PDF upload, create, create-folder, remove, share link, revoke. |
| `js/blocks.js` | Markdown → source-preserving blocks, task toggling, conflict merge. Pure. |
| `js/paths.js` | Canonical Dropbox paths: normalise, join, parent, breadcrumbs. Pure. |
| `js/recents.js` | Recent ordering, filename search, the recent-count and open/closed preferences. Pure. |
| `js/history.js` | Undo/redo as source-range operations, with a configurable depth. Pure. |
| `js/images.js` | Asset naming, the `_assets/` location, image-link resolution. Pure. |
| `js/templates.js` | The slash-menu templates and the rules for when a slash opens it. Pure. |
| `js/theme.js` | Theme choice parsing and the effective light/dark decision. Pure. |
| `js/theme-boot.js` | A classic, pre-paint script that applies the stored theme before the stylesheet loads. |
| `js/analytics.js` | The only caller of GoatCounter: guarded `trackView`/`trackEvent`, and the demo switch. |
| `js/links.js` | Finding links in a block's source and splicing one without touching the rest. Pure. |
| `js/paste.js` | Blockquote-aware paste: gives every pasted line the quote marker it is pasted into. Pure. |
| `js/share.js` | Share format choice, published-PDF records, share-sheet helpers, viewable links. Pure. |
| `js/markdown.js` | `marked` + `DOMPurify` wrapper. |
| `js/pdf.js` | A small Markdown-to-PDF renderer with no PDF library: A4, base-14 fonts, headings, lists, code, tables, links. Pure. |
| `js/editor.js` | Rendered blocks, tap-to-edit, Enter continuation, task ticking, the link editor, the keyboard formatting shortcuts. |
| `js/format.js` | Inline formatting: the delimiters, toggling them on and off, and where the caret lands. Pure. |
| `js/save.js` | Debounced, serialised autosave with a `rev` conflict check. |
| `js/mock.js` | The `?mock=1` backend, same contract as Dropbox. |
| `js/ui.js`, `js/errors.js` | Small shared helpers. |
| `js/config.js` | The app key (a public identifier) and nothing else. |
| `vendor/` | Pinned `marked`, `DOMPurify`, GoatCounter's `count.js` and the Caveat webfont, with their licences. Not a build step. |
| `icons/` | `icon.svg` is the artwork: flat colours, no gradients, no transforms, because ImageMagick rasterises it. Every PNG comes from `tools/make-icons.sh`. |
| `tools/make-icons.sh` | Rasterises the icon set (needs ImageMagick). |
| `sw.js`, `manifest.webmanifest` | PWA shell: network-first, cache name bumped by `publish.sh`. |
| `publish.sh` | Version, tag, push `main` and the site whitelist to `public`. |
| `test/` | `node --test` suites for the pure modules. |
| `report/` | The GoatCounter report script and its README. Development only; never served. |
| `pdf-poc/` | A standalone UI for the PDF renderer in `js/pdf.js`. Development only; not part of the app or the published site. |
| `docs/index.html` | The user guide, published with the app; the in-app `?` links to it. |
| `REQUIREMENTS.md` | Scope, in priority order. The "what". |
| `PLAN.md` | The phased plan: decisions, milestones, acceptance criteria, risks. |
| `POC.md` | What the earlier Dropbox proof of concept proved and the traps it paid for. |
| `README.md` | The user-facing front door. Keep it in step with behaviour you change. |
| `AGENTS.md` | This file. |
| `LICENSE` | MIT. |
| `.gitignore` | Part of every change; see "Keeping `.gitignore` current". |

There is no `.github/workflows/`: Pages deploys the published branch itself.

## Technology Stack

### Vanilla web platform (HTML, CSS, ES modules)

- **Role**: the entire application. No framework, no bundler, no transpiler.
- **Version**: whatever the current evergreen browsers and GitHub Pages serve;
  no pinned runtime.
- **Best Practices**:
  - The house rule is plain stdlib/vanilla web tech over frameworks unless a
    dependency earns its place. A dependency has to remove more code than it
    adds, and it has to work without a build step.
  - One deliberate departure from the house "single file" preference: a service
    worker must be its own URL, and any module the tests import must be a real
    module. So the JavaScript is ES modules under `js/`, not one inlined blob.
  - A classic script is the one exception, and only where a module's deferral
    would be visible: `js/theme-boot.js` sets the theme before the first paint.
    Keep it dependency-free and in step with the module that shares its key.
  - Keep modules importable in Node with no DOM dependency where the logic is
    pure (paths, task-list parsing, Markdown rendering); that is what `node
    --test` tests. The DOM-facing code stays thin.
  - No inline event handlers. The one `innerHTML` in the app is in `editor.js`,
    and it only ever receives output from `renderMarkdown`, which sanitises.
    Notes are untrusted text that arrived from someone else's Dropbox.
- **Docs**: [MDN Web Docs](https://developer.mozilla.org/en-US/) ·
  [ES modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)

### marked (vendored)

- **Role**: turns Markdown into HTML.
- **Version**: 15.0.7, pinned as `vendor/marked.esm.js` (single-file ESM, no
  build step). Licence: MIT, in `vendor/marked.LICENSE.md`.
- **Best Practices**:
  - Use `new Marked({ gfm: true, breaks: false })` from the vendored module. The
    `marked` default export is an *instance*, not the class — `new marked.Marked()`
    throws, which is exactly how the first run failed.
  - Task-list checkboxes arrive as `<input disabled type="checkbox">`; the
    editor re-enables them and maps them, in document order, to the task lines
    in the block's source. Do not parse rendered HTML to find the source line.
  - Never re-serialise the Markdown from marked's output. Rendering is one-way;
    the file is edited by source spans (`js/blocks.js`).
- **Docs**: [marked docs](https://marked.js.org/) ·
  [GFM task lists](https://www.markdownlang.com/extended/task-lists.html)

### DOMPurify (vendored)

- **Role**: sanitises the HTML marked produces before it reaches the DOM.
- **Version**: 3.4.17, pinned as `vendor/purify.es.mjs`. Licence: Apache-2.0 /
  MPL-2.0, in `vendor/dompurify.LICENSE`.
- **Best Practices**:
  - Every rendered block goes through `renderMarkdown`; there is no other
    `innerHTML` path. Keep it that way.
  - The `afterSanitizeAttributes` hook adds `target="_blank"` and
    `rel="noopener noreferrer"` to links; remove the hook and links open in the
    app's own window.
  - DOMPurify needs a DOM. In Node it is importable but unusable, which is why
    `createRenderer` takes a `sanitize` override and the tests inject one.
  - **Keep it current.** OSV listed 22 advisories against the 3.2.4 build we
    shipped, including mutation-XSS via re-contextualisation — the exact
    `sanitize()` → `innerHTML` pattern this app uses. Check
    `POST https://api.osv.dev/v1/query` for the pinned version before assuming
    a vendored copy is safe, and re-vendor rather than patching by hand.
- **Docs**: [DOMPurify](https://github.com/cure53/DOMPurify)

### PWA — Web App Manifest + service worker

- **Role**: installable on a phone, and usable with a flaky connection.
- **Version**: current browser implementations; no polyfills.
- **Best Practices**:
  - `start_url`/`scope` are `./` and the site is served from a sub-path
    (`/taisce/`), so **every** asset reference must be relative. A leading `/`
    breaks the deployed site while working perfectly on `localhost`.
  - A service worker needs a secure context: `localhost` works, plain `http://`
    on a LAN address does not. Say so in the README rather than letting people
    discover it.
  - Cache-first shells must carry a version constant that is bumped in the same
    commit as the shell change, or installed devices keep the stale page.
    (Learned the hard way in `../gealach`.)
  - Offline editing is a design decision, not an accident: if an edit cannot be
    saved, keep it and say so — never drop the user's text.
- **Docs**: [MDN: Progressive web apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps) ·
  [web app manifest](https://developer.mozilla.org/en-US/docs/Web/Manifest) ·
  [service worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)

### Dropbox API (OAuth 2 + HTTP API)

- **Role**: the only file store. Listing, reading and writing the user's notes.
- **Version**: v2 HTTP API, called directly with `fetch` — no Dropbox SDK, which
  would be a build-time dependency for a handful of endpoints.
- **Best Practices**:
  - **Public client, PKCE, no secret.** Dropbox's own documentation names pure
    JavaScript single-page apps as a case that cannot hold a `client_secret`.
    The app key (`be0wdpfwojgf4p3`, in `REQUIREMENTS.md`) is a public
    identifier and belongs in client code; the app **secret** must never be
    committed, pasted into an issue, or put in this repository in any form. Do
    not add the secret to the App Console configuration either — use PKCE.
  - `redirect_uri` must match a value registered in the App Console exactly, so
    two are registered: `https://ptaylor.github.io/taisce/` and
    `http://localhost:8080/`. A trailing-slash difference is enough to fail
    authorisation.
  - Access tokens are short-lived. Request `token_access_type=offline` to get a
    refresh token, and refresh on `401` rather than prompting the user again.
  - **A stored sign-in has a maximum age.** `js/tokens.js` holds the rule and
    `taisce.tokenDays` the setting (default 180, capped at 3650 so a typo cannot
    mean "never"). The clock starts when the refresh token is stored at sign-in
    and is **not** moved by an access-token refresh or rotation, or a device in
    daily use would never reach the limit. `sessionState`/`retireOldTokens` in
    `js/auth.js` enforce it on every read and refresh: both tokens and the saved
    date are deleted, the grant is offered to `auth/token/revoke` (best effort —
    offline expiry still signs out), and the reader is asked to connect again. A
    sign-in saved before the timestamp existed has no proof of age and is
    treated as expired. Lowering the setting below the current sign-in's age
    retires it immediately, after a confirmation.
  - Ask for the least scope that works, because Dropbox reviews exactly this at
    production approval. The app needs `files.metadata.read` (listing),
    `files.content.read` (open), `files.content.write` (save, create, upload)
    and `sharing.read` / `sharing.write` (the Share button: reuse or create a
    shared link). It does **not** use `account_info.read` — no code path calls
    `users/get_current_account`; if the App Console still lists it, remove it.
    Adding a scope re-prompts every existing user for consent, and a token that
    predates a scope fails with `missing_scope`: `ScopeError` exists for exactly
    that, and must never be treated as a sign-out, because the token is fine.
  - **A shared link is public.** `sharing/create_shared_link_with_settings` on a
    file inside the app folder is allowed (`allow_app_folder_app` is set on the
    route; the "not supported" rule is about shared *folders*). The recipient
    needs no Dropbox account and no Taisce install. Dropbox previews `.md` as
    plain text, so Share defaults to a generated `.pdf` beside the note and
    links to that; Settings can share the `.md` itself instead. Republishing
    overwrites the same PDF path, in the background after an edit as well as on
    demand, so Dropbox keeps the same shared link and people never need a new
    address. Share
    links, never files: Chromium's share sheet whitelist excludes `.md` and
    `text/markdown`, and it fails *after* `canShare()` has already said yes.
  - Paths: `""` is the root; paths have no leading slash. The provider hands the
    app `path_display`, not `path_lower`: the note's name, the `.md.bak` beside
    it, the `.pdf` made from it and the crumbs above it are all derived from
    that path, and taking `path_lower` lowercased a name the reader had typed
    with capitals. Dropbox paths are not case-sensitive, so compare them without
    case — share records are keyed by `shareKey(path)` (the lowercase form),
    where records written before this change still live.
  - `list_folder` pages: follow `cursor` while `has_more` is true, or folders
    will silently truncate.
  - Uploads replace the whole file — this app is read-whole-file / edit /
    upload-whole-file, with no partial writes. Use the `rev`/`update` write mode
    and surface the `conflict` error instead of overwriting whatever changed
    underneath.
  - A rename is `files/move_v2` with `autorename: false`, so a conflict is
    reported rather than resolved by Dropbox inventing a name. Shared links
    survive a move: `sharing/list_shared_links` still finds them, which is why
    the rename warning asks Dropbox instead of promising the link will break.
  - The token lives in `localStorage` because there is no backend. "Disconnect"
    offers the **refresh token** to `auth/token/revoke` first, then the access
    token, and forgets both locally: revoking only the short-lived token would
    leave the long-lived one alive at Dropbox. Never log a token, and never put
    one in a URL.
  - **That storage is shared.** `ptaylor.github.io` is one origin for every
    project site on the account, so any other page there can read
    `taisce.refresh` — verified, not theoretical. A custom domain is the only
    real isolation; until then, treat every other project on the domain as part
    of this app's attack surface, and keep them free of third-party scripts.
- **Docs**: [OAuth guide (PKCE, refresh tokens)](https://developers.dropbox.com/oauth-guide) ·
  [HTTP API reference](https://www.dropbox.com/developers/documentation/http/documentation) ·
  [App Console](https://www.dropbox.com/developers/apps)

### GitHub Pages (published branch)

- **Role**: hosting. The deployed app is <https://ptaylor.github.io/taisce/>.
- **Version**: no pinned runtime — the deploy uses GitHub Pages' own managed
  pipeline, which is pre-configured and not authored here.
- **Best Practices**:
  - **Two halves, kept separate.** `publish.sh` does the versioning work:
    increment the version, commit it, tag the release, push `main`, and push a
    fixed whitelist of static files to the `public` branch. GitHub Pages then
    serves `public` (`Deploy from a branch` → `/(root)`), which is what actually
    deploys the site.
  - **This repository authors no workflow.** Pages' built-in Actions deploy the
    branch; do not add a competing `pages` workflow unless the requirement
    changes, or the site has two deployment paths that can disagree.
  - The whitelist is an allow-list, never a deny-list: `test/`, `tools/` and
    `.github/` must not be reachable from the site.
  - The `public` branch is generated output. Never commit to it by hand and
    never merge it back.
  - Deploying is not the same as verifying: open the deployed URL after the
    first deploy and check the app loads from the `/taisce/` sub-path.
- **Docs**: [Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) ·
  [About GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages)

### Caveat (vendored webfont)

- **Role**: the script the wordmark is set in — the app's name in the header of
  the connect panel. The settings and help sheets set the name in italic
  interface type: there it labels the sheet rather than standing for the app on
  its own.
- **Version**: Caveat 600, latin subset, 51 KB, `vendor/fonts/caveat-600.woff2`.
  SIL Open Font License 1.1, in `vendor/fonts/caveat.LICENSE.txt`. From
  <https://fonts.google.com/specimen/Caveat>.
- **Best Practices**:
  - **Vendored, not fetched from Google.** `font-src 'self'` stays as it is, the
    app works offline, and no request goes to a third party to render its own
    name. Subsetting or changing the face means updating the file, its licence
    and the `@font-face` `unicode-range` together.
  - It is in the service worker's `SHELL`: a cold start offline must not fall
    back to cursive.
  - Only `.wordmark` uses it. Keep it that way — a script face at body size is
    unreadable, and the wordmark is the one place a size adjustment
    (`font-size: 1.28em`) is legitimate because Caveat sits small for its point
    size. `--script` in `:root` falls back to the platform's own scripts.
  - The header's `#title` is *not* the wordmark: it changes to the note's name.
- **Docs**: <https://fonts.google.com/specimen/Caveat> ·
  <https://openfontlicense.org/>

### GoatCounter (analytics)

- **Role**: privacy-friendly usage measurement — page views plus categorical
  custom events. The app previously promised "no analytics"; that promise was
  replaced with a narrower one (anonymous counts only, disclosed in the help
  sheet, the guide and the privacy policy) when the question "which features
  are worth keeping" could not be answered any other way.
- **Version**: `https://taisce.goatcounter.com`, code `taisce`.
- **Best Practices**:
  - **The counter is vendored, not loaded from `gc.zgo.at`.** This page holds a
    long-lived Dropbox refresh token in `localStorage`, and a third-party script
    running here could read it; `vendor/count.js` keeps `script-src 'self'`
    intact and is reviewed with the rest of the source. Refresh it from
    <https://gc.zgo.at/count.js> deliberately, re-applying the provenance header,
    and check the licence (ISC) while there.
  - The CSP allows exactly one host for it: `https://taisce.goatcounter.com` in
    both `connect-src` (the `sendBeacon` POST) and `img-src` (count.js falls back
    to a 1×1 image when `sendBeacon` is blocked). Widening either further needs a
    reason in the commit message.
  - Every call goes through `js/analytics.js` — `trackView` for pageviews,
    `trackEvent` for events. Both are guarded and never throw: a blocked counter
    must not break an edit.
  - **Categorical slugs only.** Never a file name, a folder, a search term, a
    note's contents or a shared link. GoatCounter also sends `location.search`
    with every hit, which is safe **because the app has no URL routing** — no
    note path is ever in the address bar. If routing is ever added, pass the path
    explicitly and strip the query.
  - **The demo is not counted.** `boot()` calls `configure({ demo: MOCK })`, so
    `?mock=1` sends nothing; its numbers would be ours, not readers'.
  - A visit is **two pageviews**: `/` and `/v<release>`, the second tagged from
    the `meta[name="app-version"]` that `publish.sh` stamps. The report reads
    releases from the second only.
  - Choosing a share format is counted as `share-format-pdf` or
    `share-format-markdown`, only when the choice changes; both slugs are in the
    report's settings group.
  - Blocking `taisce.goatcounter.com` must remain harmless: no feature and no
    layout may depend on the counter loading.
- **Docs**: <https://www.goatcounter.com/> · <https://www.goatcounter.com/api.html>

### GoatCounter report (development only)

- **Role**: `report/goatcounter-report.py` fetches the stats for a period and
  writes a self-contained HTML report with embedded charts, plus `data.json`.
  A sibling of `gealach/report/` and `foighne/report/`, same shape and helpers.
- **Version**: `requests`, `pandas`, `matplotlib` in its own venv
  (`report/.venv/`, git-ignored). Charts are optional — without them the HTML
  and JSON are still written.
- **Best Practices**:
  - **The vocabulary in the script and the vocabulary in the app are one
    thing.** The script groups events by question (arriving, files, search,
    editor, links, sharing, settings, sync, failures). An event it does not
    recognise is not silently dropped: it is listed in an "Unrecognised events"
    card and warned about on the console, so a new metric cannot go unread.
  - `reports/` is generated output and is git-ignored; so is `.env.sh`, which
    holds `GOATCOUNTER_API_TOKEN`. Never commit either.
  - `/v0-16` is a release pageview; `/version`, `/verify` and anything else that
    is not digits-and-dashes is an ordinary page. Keep that rule if the prefix
    is ever changed.
- **Docs**: [`report/README.md`](./report/README.md) ·
  <https://www.goatcounter.com/api.html>

### Node.js (tests only)

- **Role**: runs `node --test` over the pure modules. It is a development tool,
  not a runtime dependency of the app.
- **Version**: minimum Node 20 (the `node --test` runner and its reporters);
  no `package.json` dependency is expected, and a test framework would have to
  earn its place.
- **Best Practices**:
  - Tests import the same ES modules the browser imports — no duplicated logic
    and no DOM shims. If a test needs a DOM, the logic was in the wrong place.
  - Commit `package-lock.json` the moment a real dependency lands; until then
    there is nothing to lock.
- **Docs**: [node:test](https://nodejs.org/api/test.html)

## Keeping `.gitignore` current — required

`.gitignore` is part of a change, never a follow-up to it. When a change creates
files that should not be committed, the patterns go in **the same commit** — a
cached thumbnail committed by accident is much harder to remove than a line is
to add.

Keep current, at minimum:

- **Tool and dependency output**: `node_modules/`, build directories, caches.
- **Local state**: config and env files (`*.env`, `.env*`), log files, and
  anything naming this machine or a user's home directory.
- **Editor and OS metadata**: `.DS_Store`, `.vscode/`, `.idea/`, `*.swp`.

Rules:

- Prefer the official patterns published for the technology over invented ones;
  check the tool's own documentation rather than guessing.
- Group patterns by reason, each under a comment saying which tool or platform it
  belongs to, so the next reader can tell what a pattern is for.
- **Never** ignore editor tooling by reflex where the team may want it shared: an
  ignore rule is a commitment, and adding an un-ignore afterwards (`!.vscode/…`)
  is confusing. Ignore the specific local artefacts, not the whole directory, when
  that distinction matters.
- **Never commit secrets** — ignore the file that holds them. If one is committed
  by accident, say so in the commit that removes it rather than deleting it
  quietly, because the history still has it.
- The failure to watch for is the opposite of the usual one: ignoring a file the
  tool needs at run time. If it is needed to run or to build, it is source and it
  belongs in git — `manifest.webmanifest`, `sw.js` and everything in `icons/` are
  source, not generated output.

## Project rules

- **Client-side only.** No backend, no server-side secret, no proxy. Anything
  that needs a server is out of scope for this project; say so rather than
  quietly introducing one.
- **`REQUIREMENTS.md` is scope.** Do not add features it does not ask for, and
  when a requirement is ambiguous ask instead of guessing. If scope genuinely
  changes, update `REQUIREMENTS.md` in the same commit as the code.
- **Icons move together.** `REQUIREMENTS.md` asks for 64×64 and 256×256, a
  favicon and a README icon. They are the same artwork at different sizes: change
  them in one commit, from one source image, or the app and the README drift.
- **The file is the source of truth, byte-for-byte.** Every block keeps its exact
  source span and an edit replaces only that span: `serialise(parse(src))` is
  `src`. A heading edit must not reformat the paragraph below it, because the
  same file is read by other editors and on other devices. The round-trip test
  in `test/blocks.test.js` is the guard; do not "simplify" the editor into
  re-rendering the document from a parsed tree.
- **The Markdown you type is the UI.** No toolbar is required to make a heading,
  a list or bold text. Any affordance added must stay optional.
- **Every new feature asks the metrics question, and the answer goes in the
  commit.** Does this feature need a new metric, or does it change one that
  already exists? Three outcomes, all acceptable — but never "not considered":
  - **A new event** in `js/analytics.js`, with a slug added to the matching group
    in `report/goatcounter-report.py` **in the same commit**. The report is how a
    metric is read; an event it does not know appears only in its "Unrecognised
    events" card, so shipping one without the other is a self-announcing bug.
  - **A changed event**: a slug renamed, split or retired means the old name stops
    arriving and the report's group must change with it. Data either side of the
    change is not comparable — say so in the commit if a comparison matters.
  - **No metric**, because the feature is too rare, too noisy, or measuring it
    would say something about the reader rather than the app. Say that in the
    commit, in one line, so the next person knows it was a decision.
  Removing a feature retires its events by the same rule. The vocabulary is
  documented under **GoatCounter** below and must match the code exactly.
- **A name keeps the case it was typed in.** A note called `My Trip.md` has a
  backup called `My Trip.md.bak`, a shared copy called `My Trip.pdf`, and crumbs
  that read `My Trip` — one name in several places. The provider therefore
  returns Dropbox's `path_display`, and every derived path is built from it;
  `path_lower` is only for comparisons, and share records — which predate this
  rule and are keyed by the lowercase path — are reached through `shareKey`.
  Never derive a visible name, a backup path or a PDF path from a lowercased
  one: the reader sees the app give their capitals back to them in lower case.
- **A leading underscore means "not a note".** Pasted pictures go in `_assets`
  beside the note, and anything the reader wants out of the way can be hidden
  the same way. Such names are never listed, never counted in the folder
  summary, never indexed for recents or search, and the app refuses to create
  one — it must not be able to make something it then hides. The rule is one
  place, `isHiddenName`/`isHiddenPath` in `js/paths.js`, applied in both
  providers: hiding by path segment, not just by leaf, so a file inside
  `_private/` is hidden too. Notes written before the rename still point at
  `assets/`; those references keep working (resolution follows the reference,
  not the folder name) and that folder stays visible until it is renamed in
  Dropbox.
- **A PDF share is updated in place, never re-created — and it updates in the
  background.** The PDF is `<note>.pdf` beside the note, so overwriting it on
  every share keeps the Dropbox link valid; never add a timestamp, a new path or
  a cache-busting parameter, which would mint or mutate a URL that people
  already have. Once a note has a PDF behind a shared link — a record here, or a
  sibling Taisce PDF that Dropbox reports as shared; never a foreign PDF of the
  same name — later saves regenerate and upload it after a quiet period
  (`publishSharedPdf` in `app.js`), so the one link everyone holds keeps
  pointing at the latest copy. That upload is serialised with a manual share,
  carries the **saved** text not the buffer, is cancelled by delete and rename
  through `shareRun`, and those operations already await `sharePending` so it
  cannot recreate a deleted PDF or land on the old name. A failure leaves the
  record alone, so the dot stays as the cue and Share retries; it must never
  block editing. The Share button's dot compares a fingerprint of the note with
  the text last published in this browser (`js/share.js`), so it is a cue, not a
  source of truth: a share made on another device is invisible here until a save
  probes for it. Markdown mode needs no such record because Dropbox serves the
  note as edited.
  **Deleting a note deletes its PDF with it**, after the note itself is gone:
  a PDF without its note is an orphan behind a public link. A note that was
  never shared has no PDF, and `path/not_found` from that delete is the normal
  case, not a failure to report.
- **A rename follows the file, never the folder.** `provider.rename` is
  `files/move_v2` with `autorename: false`, so a name the reader typed either
  takes that name or fails; it never lands on a generated suffix. A PDF Taisce
  made moves with the note — checked for `isTaiscePdf` first, as delete does, so
  a PDF the reader exported under that name is left alone — and the published
  record and session link cache are re-keyed only when the PDF actually moved.
  Warn before renaming a shared note, asking Dropbox (`hasSharedLink`) as well as
  this browser's records, because another device's share is not in
  `localStorage`. **Dropbox keeps shared links attached to the file through a
  move**, so the warning must say the link keeps working rather than claiming it
  breaks; renaming is not unsharing. Wait for an in-flight share
  (`sharePending`) before moving the PDF, or it can land on the old path again.
- **The system back button and the back arrow are one history traversal.** The
  app is a single document with no address of its own, so the Android back
  gesture only has somewhere to go if the screens are history entries:
  `loadList` and `openFile` record `{screen, dir, path, name, depth}` in
  `history.state` (`recordView` in `app.js`), `popstate` restores the screen,
  and the header arrow calls `history.back()` rather than stepping screens
  behind history's back. Never put a note path in the URL: `js/analytics.js`
  sends `location.search` with every hit. `navId` makes the newest navigation
  win — a folder listing or note read that finishes after a back press must not
  paint over the screen that replaced it. Back closes an open sheet before it
  moves the screen. Deleting a note marks its entry `deleted` before popping it,
  so Forward cannot reopen a file that is gone.
- **A wait never looks like the previous screen.** Anything that awaits the
  network — opening a folder, opening a note, uploading a pasted picture —
  clears what it is about to replace *before* awaiting, and covers the screen
  with `showBusy(label)` until the answer arrives: a new note's name above the
  last note's text is a lie for as long as the read takes, and a stale note is
  worse than a blank one. `#busy` is solid rather than translucent for the same
  reason, and its pencil writes the wavy line it is waiting for (motion dropped
  under `prefers-reduced-motion`, which keeps the picture and the words). Inline
  waits that belong to one control — a share link being fetched — say so in
  place instead of covering the app.
- **A destructive action asks first, and the safe answer is the default.** Use
  `ask({ title, body, ok, danger: true })` from `js/ui.js`: the title names the
  thing (`Delete "shopping"?`), the body says where it goes and what is left
  behind, the accepting button is red rather than the primary colour, and Cancel
  keeps the initial focus so a stray Enter cancels. Nothing in the app may
  delete, overwrite or revoke on a single tap. Deleting a note moves it to the
  Dropbox trash — recoverable — and takes the pictures that note links to with
  it, and only those: `_assets/` is shared by every note in a folder, so the
  attribution is per note (`attachedImages` in `js/images.js`), never the folder.
  A picture belongs to one note because a pasted one is named with a timestamp
  and a random suffix; delete by that attribution rather than by guessing.
- **A backup is background housekeeping, never part of opening.** `openFile`
  hands the text it read to `js/backup.js` only after the note is on screen, and
  does not await it: the file must appear at the same speed with or without a
  backup. Each open replaces `<note>.md.bak` — metadata first, so a folder at
  that path is never deleted with its contents — writes to one path are
  serialised, and a failure is counted (`error-backup`) and logged rather than
  shown. Do not back up on save
  (a copy that follows every keystroke is not a backup), and do not back up an
  empty note, which would only delete a useful earlier copy.
- **A link is edited where it sits.** Clicking a rendered link opens an editor
  for that one link — text, address, copy, open, remove — rather than following
  it; `js/links.js` finds the link's exact span in the block source and splices
  only the label and the destination, so nothing else in the block is rewritten.
  A rendered anchor is matched to its source by position, and only when the
  counts agree: if a note uses raw HTML anchors or reference-style links, that
  block falls back to plain web links rather than risking an edit in the wrong
  place. Keep that fallback — a wrong edit to someone's words is worse than a
  missing convenience. `js/links.js` therefore has to recognise exactly what
  `marked` linkifies — `[text](url)`, `<autolink>`, bare `http(s)`/`ftp`/`www`
  URLs and bare email addresses, with the same trailing-punctuation rule — or a
  single unrecognised link disables editing for its whole block. The corpus test
  in `test/links.test.js` renders notes and asserts the two agree href for
  href; add to it when you touch either side.
- **Undo is source ranges, not snapshots.** `js/history.js` records
  `{start, before, after}`; applying ops in reverse keeps offsets valid. Never
  swap this for whole-document snapshots of every keystroke.
- **Images are uploaded before they are linked.** A link to a picture that
  failed to upload is worse than no link. Relative image sources are parked on a
  blank pixel until the authenticated fetch resolves, or the browser logs a 404
  for a path the web server does not have. A picture is tapped, not edited:
  tapping one opens View/Delete, so `hydrateImages` must keep the original
  relative reference on the element (`data-src`) — it is what the delete removes
  from the note once the file is gone, and the blob URL in `src` cannot be
  turned back into a path.
- **Dropbox is an adjective, not a noun.** Write "your Dropbox account", "the
  Dropbox app folder", "compatible with Dropbox" — never "your Dropbox",
  "Dropbox's files", or the name pluralised or possessive. The
  [branding guidelines](https://www.dropbox.com/branding) require the word mark
  to be a capitalised adjective, and the
  [developer branding guide](https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/branding-guide)
  is a condition of production approval. Never use the Dropbox logo, its blue,
  or a screenshot of a Dropbox product in this app; if that ever changes, use
  only the approved assets from <https://brand.dropbox.com/>. Keep the
  non-affiliation line in `README.md`, `docs/index.html` and `docs/privacy.html`.
- **Notes are untrusted input, including their images.** A note must never
  cause a request: remote images are converted to links *before* the markup is
  inserted (an `<img>` with a remote `src` fetches even inside a detached
  element), relative images are parked on a blank pixel until they are fetched
  with the user's token, and `style`/`id`/`name` attributes are stripped by the
  sanitizer. The meta Content-Security-Policy is the second line of defence —
  keep it, and remember `style-src` needs `'unsafe-inline'` only because the
  editor sets `textarea.style.height`.
- **Nothing renders unsanitised.** `renderMarkdown` is the only path to
  `innerHTML`; a note can come from someone else's Dropbox.
- **Colours live in `:root`, built on St Patrick's Blue.** `#23297a`
  ([encycolorpedia](https://encycolorpedia.com/23297a)) is the brand colour and
  the light-mode accent; dark mode uses a lighter tint of the same hue because
  the brand blue is unreadable on a dark page, and pairs it with `--on-accent`
  so button text stays legible. Keep the palette in one place so the CSS, the
  manifest `theme_color`, the meta theme colours and `icons/icon.svg` cannot
  disagree. The palette is written `light-dark(light, dark)`, so a page with no
  choice of its own — the guide and the privacy policy share this stylesheet —
  follows the device. `data-theme` on `<html>` sets `color-scheme`, which is what
  makes an explicit choice win: `js/theme-boot.js` sets it before the first paint
  and `js/theme.js` keeps it current. `--chrome` is copied into the
  `theme-color` metas, so an explicit choice also colours the browser's own bar.
- **Verify before claiming done.** Run the tests and load the page — a static
  site has no compiler to catch a broken module path, and the deployed
  sub-path is where relative URLs go wrong.
- **Keep this file current.** A change that introduces a language, library or
  dependency updates the matching Technology Stack entry (with rationale, best
  practices and docs links) and adds its `.gitignore` patterns in the same commit.

## Commit conventions

- Imperative sentences, no conventional-commit prefix: "Open task lists in the
  task view".
- The subject says what changed; the body says **why**, and records the trap that
  was avoided or the measurement that justified the choice.
- One logical change per commit.

## AI attribution — required

Any commit produced with an AI coding assistant — for the code, the docs, the
artwork, or the commit message itself — must end with a trailer naming the
assistant **and** the exact model and version:

```
Assisted-by: <assistant> (<model> <version>)
```

```
Assisted-by: GitHub Copilot (DeepSeek V4 Flash)
```

Rules:

- Name the model you were actually running, and its version when it has one.
  "AI", "Copilot", "an LLM" or a bare tool name is not attribution.
- One trailer per assistant: two assistants on one commit means two
  `Assisted-by:` trailers.
- Use `git commit --trailer "Assisted-by=GitHub Copilot (DeepSeek V4 Flash)"`
  rather than hand-placing the line, so it lands in the trailer block.
- No trailer means the work was written by hand. Never add one for a change you
  did not make.

### Elsewhere, not only in commits

Git history is not the only place this is read, so the same attribution applies
wherever the work is visible without it:

- **Documents and prose** substantially written by an assistant — this file,
  `README.md`, design notes — carry the assistant, model and version, either as a
  note in the document or in a short "AI contributions" list.
- **Release notes, changelogs, tags and pull-request descriptions** written with
  an assistant end with the same `Assisted-by:` trailer.
- **Generated artefacts** that are committed (icons, fixtures) record in their
  header or in the command that regenerates them which tooling and which
  assistant produced them, so the result can be reproduced.

When in doubt, attribute. An unnecessary trailer costs a line; a missing one
misrepresents who wrote the work.

## General house rules

- **License**: every repository ships a `LICENSE`. Default to MIT. Use
  AGPL-3.0-or-later when the project links or invokes GPL-licensed tooling (for
  example a `--enable-gpl` FFmpeg build), or when the work should stay reusable by
  AGPL projects.
- **README**: every repository has a README that says what the project is, how to
  install it, and how to use it.
- **Install**: command-line tools install via an idempotent `install.sh` that
  symlinks into `$HOME/bin`, and warn when `$HOME/bin` is not on `PATH` (zsh).
  Taisce is a web app, not a command-line tool, so there is nothing to install —
  that is a reason not to invent an `install.sh`, not a reason to skip the rule.
- **Prefer self-contained, low-dependency tooling**: plain stdlib/Python or vanilla
  web tech over frameworks unless a dependency earns its place, and single-file
  scripts with embedded frontend assets over separate `static/` folders. The PWA
  is the documented exception (see Technology Stack).
- **Verify before claiming done**: run the build, tests, linters, or a dry run and
  record the outcome in the commit body.
- **Keep this file current**: when a change introduces a language, library, or
  dependency, update `AGENTS.md` in the same commit — with rationale, a Best
  Practices block, and docs links — and add the matching `.gitignore` patterns in
  that same commit.

---

This file was written with an AI coding assistant.
Assisted-by: GitHub Copilot (DeepSeek V4 Flash)
Assisted-by: Claude Code (deepseek-flash)
