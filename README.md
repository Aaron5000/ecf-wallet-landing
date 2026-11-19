# ECF Wallet landing page

Developer handoff for the approved ECF Wallet landing page.

**Shared preview:** https://ecf-wallet-preview.vercel.app/

## Run locally

Requires Python 3. No package install, build step, backend, or environment variables are needed to serve the page.

```sh
python3 serve.py
```

Open http://127.0.0.1:4180/. The local server disables caching. Use `python3 serve.py 8080` to choose another port.

## Project map

| File | Purpose |
| --- | --- |
| `index.html` | Page copy, navigation, FAQ, inline icons, and HTML wallet illustration |
| `styles.css` | ECF branding, typography, responsive layout, and wallet illustration styling |
| `main.js` | Changes install buttons to Firefox when appropriate |
| `ascii-motion.js` | Key and landscape animation rendering, scroll reveals, and motion lifecycle |
| `art-data.js` | Committed character/color data generated from the ANSI source files |
| `art-source/` | Original key and landscape ANSI grids for rebuilding the art data |
| `build_art.py` | Dependency-free art-data generator |
| `assets/` | ASCII fallback images and official network logos |
| `fonts/` | Locally served PP Supply Mono fonts |
| `ASSETS.md` | Asset provenance and rights notes |

The site is plain HTML, CSS, and JavaScript. The wallet displayed in the hero is an editable HTML illustration, not a screenshot or live wallet. Its 10,000 ETH balance is demo content; keep the main balance, asset row, and accessible description consistent when changing it.

## Animation and integration notes

Load the deferred scripts in their existing order: `main.js`, `art-data.js`, then `ascii-motion.js`.

The key uses WebGL shading sampled into a fixed ASCII grid, with a procedural fallback. The landscape uses canvas layers and looping stars. Preserve the `data-art` attributes, canvas markup, and fallback images when integrating into another framework. Animation respects reduced-motion preferences and pauses when offscreen or when the document is hidden. Pointer interaction affects the key.

Styles use global selectors. Scope or review them when moving the page into an existing website. Keep relative asset/font paths valid at the final route. The static page requires no server API or wallet connection.

## Rebuild artwork

The generated `art-data.js` is committed, so rebuilding is optional. To regenerate it from the included sources:

```sh
python3 build_art.py
```

To use another ANSI source folder containing `12-key.ans` and `22-ethscape.ans`:

```sh
python3 build_art.py --src /path/to/ansi-files
```

This regenerates character/color data only. The key's procedural geometry and animation live in `ascii-motion.js`; PNG fallbacks are separately committed assets.

## Deploy and update the shared preview

Serve this directory with any static host. Vercel should use the **Other** framework preset with no build command and the project root as the output. `.vercelignore` excludes development-only files.

The existing Vercel project is `ecf-landing` in `aarons-projects-e903cf99`. Its local `.vercel` account linkage is intentionally not committed. An authorized maintainer can link a fresh checkout with `vercel link` and select that existing project.

```sh
vercel deploy --yes
# After the deployment reports READY:
vercel alias set <new-deployment-url> ecf-wallet-preview.vercel.app
```

Always share https://ecf-wallet-preview.vercel.app/. A new deployment does not automatically move this alias; update it after each preview deployment. Keep preview deployment separate from production promotion. The shared preview is public. GitHub pushes are not configured by this handoff to auto-deploy.

## Verification before release

- Run `node --check main.js` and `node --check ascii-motion.js` if Node.js is available.
- Check desktop and phone widths, navigation anchors, and FAQ expand/collapse behavior.
- Check the Chrome install links and Firefox button switching.
- Scroll through both artwork sections; check reduced motion and fallback behavior.
- Confirm the shared preview serves the new copy after updating its alias.

The authored page includes no analytics SDKs or runtime data API calls. Vercel may inject its preview feedback toolbar independently of these source files.

## Content handoff

Keep zero telemetry prominent and defined as no usage analytics or remote crash reporting. Preserve the disclosures about RPCs, function lookups, and optional NFT services: zero telemetry does not make those network requests anonymous. The page states that six networks are built in and custom EVM networks/RPCs can be added. Key-custody wording leaves storage decisions to the user.

The source and MIT-license links on the page refer to the separate [wallet application](https://github.com/ETHCF/ethereum-wallet), not a license grant for every asset in this landing-page repository. See `ASSETS.md`.
