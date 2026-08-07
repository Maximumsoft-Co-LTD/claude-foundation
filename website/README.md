# website/

The public site at <https://claude-foundation.dev/>.

Published to a **custom domain**, configured on the repository's Pages settings
(`cname: claude-foundation.dev`). The site is therefore served at the domain
root — the bare `maximumsoft-co-ltd.github.io/claude-foundation/` URL is not the
canonical address, and assuming it is puts the docs one path segment too deep.
There is no `CNAME` file in this directory; the domain lives in repo settings and
survives each Actions deploy.

Repository-only — nothing here is installed into a consumer project. It is not
listed in `MANAGED` in `install.sh`.

## What is here

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The landing page. Hand-written, no build step. |
| `docs/` | The documentation site. Astro + Starlight, **has** a build step. |
| `demo/` | A sample consumer project. Static. |
| `.nojekyll` | Stops GitHub Pages running Jekyll over the output. |

Two different things live side by side: the landing page is served as-is, the
docs are compiled. That is the main thing to keep in mind below.

## Run the docs

```bash
npm --prefix website/docs install
npm --prefix website/docs run dev
```

Then open **<http://localhost:4321/docs/>**.

> [!IMPORTANT]
> `http://localhost:4321/` on its own returns 404, and that is correct.
> The docs live under `/docs` on the domain, so `astro.config.mjs` sets
> `base: "/docs"` and the dev server honours it. If that base did not match the
> deployed path, every internal link would 404 in production while looking fine
> locally — which is exactly what a `/claude-foundation/docs` base would do here,
> since the custom domain serves this site at its root.

Other scripts, all from `website/docs`:

```bash
npm run build     # compile to website/docs/dist
npm run preview   # serve the built output (also under /docs/)
npm run check     # type-check the Astro project
```

## Run the landing page

It has no build step, so any static server works:

```bash
python3 -m http.server 8899 --bind 127.0.0.1 --directory website
```

Open <http://127.0.0.1:8899/>. Its `Docs` link points at `./docs/`, which will
only resolve once the docs have been built.

## Preview the whole site exactly as deployed

This mirrors exactly what the Pages workflow uploads. Because the custom domain
serves the site at its root, the assembled tree is served at the root here too —
no prefix directory. Use it before changing anything about links, the base path,
or the assemble step.

```bash
npm --prefix website/docs run build

rm -rf /tmp/cf-site && mkdir -p /tmp/cf-site
rsync -a --exclude '/docs/' website/ /tmp/cf-site/
cp -R website/docs/dist/. /tmp/cf-site/docs/

python3 -m http.server 8931 --bind 127.0.0.1 --directory /tmp/cf-site
```

- Landing — <http://127.0.0.1:8931/>
- Docs — <http://127.0.0.1:8931/docs/>
- Thai — <http://127.0.0.1:8931/docs/th/>

## Deploying

`.github/workflows/pages.yml` runs on pushes to `main` that touch `website/**`,
and can be run by hand from the Actions tab. It installs and builds the docs,
then assembles one artifact:

```bash
rsync -a --exclude '/docs/' website/ _site/   # everything except the docs source
cp -R website/docs/dist/. _site/docs/         # the built docs on top
```

**Everything under `website/` ships.** The copy is not an enumerated file list,
because such a list silently drops anything added later and the omission only
appears as a 404 in production. The single exclusion is the docs *source* tree,
which is a build input, not an artifact. The workflow then asserts the key files
exist and that no source leaked, so a half-assembled site fails the job instead
of deploying.

## Editing the docs

Content lives in `docs/src/content/docs/`, English at the root and Thai under
`th/`. Both locales must carry every page listed in the `sidebar` of
`astro.config.mjs` — Starlight falls back to English for a missing translation,
which silently strands a Thai reader on an English page.

The site is **light-only on purpose.** The landing page declares
`color-scheme: light` and paints many colours that its CSS variables do not
drive, so it has no dark palette to match; the docs follow it rather than
handing a dark-preferring reader a cream landing page and then a dark docs site.
That is enforced in three places, and all three are needed:

- `docs/src/styles/brand.css` pins the palette for every `data-theme` value;
- `docs/src/components/ThemeProvider.astro` pins the attribute itself, because
  Expressive Code swaps its syntax theme off `data-theme` independently of
  Starlight's colour variables;
- `docs/src/components/ThemeSelect.astro` is empty, removing a toggle that
  could no longer change anything.

`docs/src/components/SiteTitle.astro` reuses the landing page's brand markup
directly. Keep it in step with `.brand` / `.brand-mark` in `styles.css`.

> [!CAUTION]
> The doc pages quote runtime facts — capability counts, adapter names, protocol
> pins, command behaviour. The workflow only redeploys on `website/**`, so a
> change under `.claude/harness/` can make a documented fact stale without any
> deploy running. Re-check the affected page when you change a shipped contract.

## Notes

- `.claude/tests/harness/run-context-budget-tests.sh` asserts on
  `website/index.html` — it checks the command list names `proof run` and not
  the internal `proof execute`. Run it after editing the landing page.
- npm 11 blocks package install scripts by default. `docs/package.json` records
  the approval esbuild needs under `allowScripts`, so `npm ci` works on CI
  without prompting.
- `docs/dist/` and `docs/node_modules/` are gitignored; the build output is
  regenerated on every deploy and is never committed.
