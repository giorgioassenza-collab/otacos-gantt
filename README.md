# O'Tacos Workflow

Live site: https://giorgioassenza-collab.github.io/otacos-gantt/

This repository is published straight from the root of `main` (GitHub Pages, "Deploy from a branch").

| Path | What it is |
|---|---|
| `/` (index.html, assets/, sw.js, ...) | The built app that people open. Generated, do not edit by hand. |
| `source/` | The React + TypeScript + Vite project the root is built from. See `source/PRODUCT.md` and `source/docs/ui-conventions.md`. |
| `legacy-v1/` | The previous single-file version of the site, kept so it can still be opened at `/otacos-gantt/legacy-v1/` and used as a rollback. Git tag `legacy-v1` marks the commit it was replaced at. |

## Updating the site

1. Work in `source/` (`npm install`, `npm run dev`; open `/otacos-gantt/?demo=1&seed=1` for a local demo board that never touches Firebase).
2. Build in a folder whose path has **no apostrophe** (the service-worker generator breaks on one): copy `source/` somewhere like `C:\build\otacos`, run `npm ci && npm run build`.
3. Replace the root files (everything in `dist/`) in this repository with the new `dist/` and push to `main`. Keep `source/` and `legacy-v1/`.

Data lives in Firestore document `boards/default` (project `o-tacos-gantt`), shared with `legacy-v1`.
