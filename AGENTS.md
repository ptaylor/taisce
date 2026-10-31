# AGENTS.md

Instructions for any human or AI agent working in this repository.

## Summary

Taisce (*TAHSH-keh*, Irish for "hoard" or "store") is a browser app for writing
and editing plain-text files in the user's own Dropbox: lists, numbered lists,
task lists, free-form notes, Markdown and specs. It is a PWA served as a static
site from GitHub Pages — there is no server of ours, no database, and no copy of
anyone's files anywhere except their own Dropbox and their own browser.

`REQUIREMENTS.md` is the source of truth for **what** the app must do. This file
covers **how** the repository is worked on. When the two disagree about scope,
`REQUIREMENTS.md` wins; when they disagree about conventions, this file wins.

## Status

**Pre-implementation.** The repository holds `README.md`, `LICENSE`,
`REQUIREMENTS.md` and this file. There is no application code, no build step and
no tests yet.

Active milestone: the first end-to-end path — Dropbox OAuth (PKCE) → list a
folder → open a file → edit → save it back → install as a PWA. Everything else
in `REQUIREMENTS.md` (the six file formats, settings, icons, the marketing page)
comes after that path works.

Known gaps, in the order they are likely to bite:

- No code, no icons, no manifest, no service worker.
- The GitHub Pages deployment (`publish.sh` → `public` branch → Pages) does not
  exist yet.
- Dropbox scopes and the registered redirect URIs are not yet recorded anywhere
  in the repository; whichever commit wires up OAuth must record both.

## Commands

There is nothing to build or test yet. A command appears here in the same commit
that makes it work — never before, because a documented command that fails is
worse than a missing one.

Once the static site exists, these are the intended entry points:

```sh
python3 -m http.server 8080   # local preview at http://localhost:8080
npm test                      # node --test, no runtime dependencies
```

There is **no build step**. If a change makes one necessary, it has to earn its
place (see "Project rules"); the default is that what is committed is what is
served.

## Layout

| Path | What it is |
| --- | --- |
| `REQUIREMENTS.md` | Scope: file formats, settings, icons, host URL, Dropbox app. The "what". |
| `POC.md` | What the earlier Dropbox proof of concept proved, how it worked, and the traps it paid for. Reference, not a dependency. |
| `PLAN.md` | The phased implementation plan: decisions, milestones, acceptance criteria and risks. |
| `README.md` | The user-facing front door. Keep it in step with behaviour you change. |
| `AGENTS.md` | This file — conventions for working in the repository. |
| `LICENSE` | MIT. |
| `.gitignore` | Part of every change; see "Keeping `.gitignore` current". |

The application does not exist yet. The intended shape, when it does, is a
static site at the repository root — `index.html`, `js/` (ES modules), `icons/`,
`manifest.webmanifest`, `sw.js` — plus `publish.sh` at the root. There is no
`.github/workflows/`: Pages deploys the published branch itself. Update this
table in the commit that creates each entry.

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
  - Keep modules importable in Node with no DOM dependency where the logic is
    pure (paths, task-list parsing, Markdown rendering); that is what `node
    --test` tests. The DOM-facing code stays thin.
  - No inline event handlers, and no `innerHTML` with user file content — notes
    are untrusted text that arrived from someone else's Dropbox.
- **Docs**: [MDN Web Docs](https://developer.mozilla.org/en-US/) ·
  [ES modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)

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
  - Ask for the least scope that works: `files.metadata.read`,
    `files.content.read`, `files.content.write`; `account_info.read` only if the
    interface actually greets the user by name. Adding a scope re-prompts every
    existing user for consent.
  - Paths: `""` is the root; paths have no leading slash. Use `path_lower` for
    comparisons and `path_display` only for display — Dropbox paths are not
    case-sensitive.
  - `list_folder` pages: follow `cursor` while `has_more` is true, or folders
    will silently truncate.
  - Uploads replace the whole file — this app is read-whole-file / edit /
    upload-whole-file, with no partial writes. Use the `rev`/`update` write mode
    and surface the `conflict` error instead of overwriting whatever changed
    underneath.
  - The token goes in browser storage the user can clear (and "Logout" and
    "Disconnect" do exactly that, including revoking the token). Never log a
    token, and never put one in a URL.
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
- **The same file, several ways of looking at it.** "List", "Numbered List",
  "Task List", "Markdown", "Spec" and "Free Form" are views over a plain-text
  file, not six file formats. Whatever a view adds (task checkboxes, strikethrough
  for done) must round-trip to text that the other views still read. A saved file
  must be worth reading in a text editor.
- **Colours are a setting, not a skin.** Keep the palette in one place so the
  settings screen, the manifest `theme_color` and the CSS cannot disagree.
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
