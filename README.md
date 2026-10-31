# Taisce — notes in your own Dropbox

> *taisce* — Irish: a hoard, a store, a treasure.

Taisce is a small web app for reading and writing Markdown files that live in
your own Dropbox. It renders the file — headings, lists, code, links, task
lists — and lets you edit it where you read it: tap a paragraph, type, and the
change is already saved. Tick a task item and the file changes. It installs like
an app (it is a PWA), works on a phone, and keeps every file where it already
belongs.

There is no account with us, no database, and no server of ours in the middle:
the app is a static site, and it talks to Dropbox directly from your browser.

**Status: in planning.** This repository currently holds the requirements, the
licence and the conventions — there is no application code yet, so there is
nothing to install or open. [`REQUIREMENTS.md`](./REQUIREMENTS.md) is the scope;
[`AGENTS.md`](./AGENTS.md) explains how the repository is worked on, and
[`POC.md`](./POC.md) records the working Dropbox proof of concept this app
builds on. [`PLAN.md`](./PLAN.md) is the phased plan for building it.

## Planned

- **Read and write your Markdown files in Dropbox**, authorised with OAuth
  (PKCE — the app never holds a secret), with a disconnect that revokes the
  token.
- **Rendered Markdown, edited in place.** No Save button: edits autosave.
  Typing `## `, `**bold**` or `- [ ] ` is the formatting UI. Task items are
  ticked by tapping them, straight from the rendered file.
- **Folders with nesting** (P2), **recent files and filename search** (P3),
  **undo and pasted images** (P4).
- **Installable on a phone**, with 64×64 and 256×256 icons, a favicon, and a
  documentation page carrying the instructions (P3).
- **Hosted at <https://ptaylor.github.io/taisce/>**: `publish.sh` versions and
  pushes the site files to a `public` branch, and GitHub Pages serves that
  branch.

## Running it

Once the app exists, it is a static site with no build step:

```sh
python3 -m http.server 8080
```

then open <http://localhost:8080>. Serve it rather than opening the file
directly: a service worker needs a real origin, and `file://` is not one.

Tests, once there are any:

```sh
npm test
```

## Deploying

`main` is the working branch and is never served. Two halves, deliberately
separate:

1. **`publish.sh`** bumps the version, tags the release, pushes `main`, and
   pushes a fixed whitelist of site files to the `public` branch.
2. **GitHub Pages** serves the `public` branch. That deployment is Pages' own
   managed pipeline — the pre-configured Actions behind *Deploy from a branch* —
   so this repository authors no workflow of its own. Point Pages at
   *Deploy from a branch → `public` → `/(root)`* once in the repository settings.

Because the site is served from the `/taisce/` sub-path, every URL in the app is
relative. A leading `/` works on `localhost` and breaks the deployed site.

## Privacy

- Your notes stay in your Dropbox. Nothing is sent anywhere else — there is no
  analytics and no third-party script.
- The Dropbox access token lives in your browser's storage and leaves when you
  log out or disconnect. Disconnecting also revokes it at Dropbox.
- The Dropbox app key (`be0wdpfwojgf4p3`) is a public identifier. The app secret
  is never used and never stored in this repository.

## Licence

MIT (see [`LICENSE`](./LICENSE)).

---

This file was written with an AI coding assistant.
Assisted-by: GitHub Copilot (DeepSeek V4 Flash)
