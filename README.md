# Taisce — notes in your own Dropbox

> *taisce* — Irish: a hoard, a store, a treasure.

Taisce is a small web app for writing and editing text files that live in your
own Dropbox: plain lists, numbered lists, task lists, free-form notes, Markdown
and specs. It installs like an app (it is a PWA), works on a phone, and keeps
every file where it already belongs — in your Dropbox, in a folder you choose.

There is no account with us, no database, and no server of ours in the middle:
the app is a static site, and it talks to Dropbox directly from your browser.

**Status: in planning.** This repository currently holds the requirements, the
licence and the conventions — there is no application code yet, so there is
nothing to install or open. [`REQUIREMENTS.md`](./REQUIREMENTS.md) is the scope;
[`AGENTS.md`](./AGENTS.md) explains how the repository is worked on, and
[`POC.md`](./POC.md) records the working Dropbox proof of concept this app
builds on.

## Planned

- **Read and write your files in Dropbox**, authorised with OAuth (PKCE — the
  app never holds a secret), with a disconnect that revokes the token.
- **Six ways to look at the same text**: list, numbered list, task list,
  free-form, Markdown, spec — plus copy and paste. Each is a view over one plain
  text file, not a separate format.
- **Settings**: colours, and whether finished tasks are struck through.
- **Installable on a phone**, with 64×64 and 256×256 icons, a favicon, and an
  app website carrying the instructions.
- **Hosted at <https://ptaylor.github.io/taisce/>**, published by GitHub Actions
  to a `public` branch.

## Running it

Once the app exists, it is a static site with no build step:

```sh
python3 -m http.server 8000
```

then open <http://localhost:8000>. Serve it rather than opening the file
directly: a service worker needs a real origin, and `file://` is not one.

Tests, once there are any:

```sh
npm test
```

## Deploying

`main` is the working branch and is never served. GitHub Actions publishes a
fixed whitelist of site files to the `public` branch, and GitHub Pages serves
that branch at <https://ptaylor.github.io/taisce/>. Point Pages at
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
