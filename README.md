<p align="center"><img src="icons/icon-512.png" alt="Taisce icon" width="96" /></p>

# Taisce — Markdown notes in your own Dropbox

> *taisce* — Irish: a hoard, a store, a treasure.

Taisce is a small web app for reading and writing Markdown files that live in
your own Dropbox. It renders the file — headings, lists, code, links, task
lists — and lets you edit it where you read it: tap a paragraph, type, and the
change is already saved. Tick a task item and the file changes. It installs like
an app (it is a PWA), works on a phone, and keeps every file where it already
belongs.

There is no account with us, no database, and no server of ours in the middle:
the app is a static site, and it talks to Dropbox directly from your browser.

## How to use it

- **Tap a block to edit it.** The Markdown you type is the formatting — `## ` at
  the start of a line makes a heading, `**bold**`, `` `code` ``, `- ` a list.
  There is no toolbar, because the syntax already is one.
- **Leave the block and it renders again.** A block shows its source only while
  it has the caret.
- **There is no Save button.** Edits save by themselves about a second after you
  stop typing, and when the app is put away. There is no Cancel button either.
- **Tap a task item** in the rendered file to check or uncheck it. The file is
  updated and saved exactly like any other edit.
- **Folders work like folders.** Tap one to go in, use the trail at the top (or
  the back arrow) to come back up. **+** creates a file or a folder in the
  folder you are looking at, so nesting is just a matter of going in first.
- **Undo, without a Save button.** The round buttons at the bottom right (or
  Cmd/Ctrl+Z) step back through block edits; how many steps are kept is a
  setting. Undo survives the autosave, because it writes like any other edit.
- **Paste a picture** into a note: it is uploaded to an `assets` folder beside
  the note and linked in relatively, so the note still renders in any other
  Markdown editor.
- **Finding things.** The home screen lists the files you changed most
  recently (Settings controls how many), and the search box matches file names
  across every folder, showing where each match lives.
- **Connect once.** The app only ever sees its own folder in your Dropbox
  (`Apps/Taisce`), never the rest of your account.
- **Disconnect** revokes the token at Dropbox and forgets it on the device. Your
  files are never touched.

## Status

**All four phases are working** — sign-in, folders with nesting and breadcrumb
navigation, rendered Markdown, in-place editing with autosave, interactive task
lists, new files and folders, recent files, filename search, undo/redo, pasted
images, the guide at [`docs/`](./docs/index.html), icons and the publish script.
Not yet done, and deliberately so: offline writing (a save while offline errors
and keeps your text) and any sharing beyond Dropbox itself.
[`PLAN.md`](./PLAN.md) has the detail; [`POC.md`](./POC.md) records the proof of
concept this was built from.

## Running it locally

It is a static site with no build step. Serve it — do not open the file
directly, because a service worker needs a real origin:

```sh
python3 -m http.server 8080
```

then open <http://localhost:8080>. The port matters: `8080` is the local
redirect URI registered with Dropbox, so sign-in only returns to that port.

Add `?mock=1` for a demo backed by `localStorage`, with no Dropbox account and
no token: <http://localhost:8080/?mock=1>.

## Dropbox setup

The app key is in [`js/config.js`](./js/config.js) and is a public identifier —
the app uses OAuth with PKCE and never holds a secret. Two redirect URIs must be
registered in the App Console (*Settings → OAuth 2 → Redirect URIs*), each
matching exactly, trailing slash included:

```text
http://localhost:8080/
https://ptaylor.github.io/taisce/
```

The Dropbox app needs: **Scoped access**, **App folder** named `Taisce`, and the
permissions `account_info.read`, `files.metadata.read`, `files.content.read`,
`files.content.write`.

## Guide

The user guide lives at [`docs/index.html`](./docs/index.html) and is published
with the app at <https://ptaylor.github.io/taisce/docs/>. The in-app **?** opens
a short version of the same thing and links to the full page.

## Tests

```sh
npm test        # node --test, no dependencies
```

## Icons

`icons/icon.svg` is the artwork; every PNG is rasterised from it by
`tools/make-icons.sh`. Change the SVG and re-run the script in the same commit,
so the favicon, the app icons, the README image and the Dropbox App Console
branding (64×64 and 256×256) cannot drift apart.

## Deploying

`main` is the working branch and is never served. Two halves, deliberately
separate:

1. **`publish.sh`** bumps the version, tags the release, pushes `main`, and
   pushes a fixed whitelist of site files to the `public` branch.
2. **GitHub Pages** serves the `public` branch. That deployment is Pages' own
   configured pipeline (*Deploy from a branch → `public` → `/(root)`*), so this
   repository authors no workflow of its own.

```sh
./publish.sh --no-push   # print the next version and what would be published
./publish.sh             # bump, tag, push main + tag + public
```

Because the site is served from the `/taisce/` sub-path, every URL in the app is
relative. A leading `/` works on `localhost` and breaks the deployed site.

## Privacy

- Your notes stay in your Dropbox. Nothing is sent anywhere else — no analytics,
  no third-party scripts; the Markdown renderer is vendored in `vendor/`.
- The Dropbox refresh token lives in this browser's `localStorage`. That is a
  deliberate trade for having no backend: any script running on this origin
  could read it, which is why there are no third-party scripts and everything
  rendered from a file is sanitised.
- Disconnecting revokes the token at Dropbox as well as forgetting it locally.

## Licence

MIT (see [`LICENSE`](./LICENSE)). The vendored libraries keep their own licences
in [`vendor/`](./vendor).

---

This file was written with an AI coding assistant.
Assisted-by: GitHub Copilot (DeepSeek V4 Flash)
