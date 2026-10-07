# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + TypeScript + Vite, chosen by the user over plain HTML/CSS/JS. Built as an installable PWA. Backend is the existing Firebase project `o-tacos-gantt` (Firestore + Auth). Deploys to the existing GitHub repo `giorgioassenza-collab/otacos-gantt` on GitHub Pages, replacing the current site.

## Users

The O'Tacos marketing and social team (a handful of named people, e.g. Max, Giorgia, Alice appear in the current app as assignees and approvers). They plan content and influencer work for a tacos restaurant brand. They use it at a desk on desktop and on the phone, including away from the desk (in store, on the move). Everyone on the team shares one login today; the user confirmed that stays (see Constraints).

## Product Purpose

An internal workflow board for O'Tacos social and influencer marketing. It replaces a single 14,000-line HTML file (https://giorgioassenza-collab.github.io/otacos-gantt/) with an app that does the same job, only better: faster, maintainable, and usable on a phone as well as on desktop. Success means the team can open it on any device, find or change a task or post in a few taps, and trust that everyone sees the same data.

## Positioning

An in-house tool shaped around O'Tacos' own process rather than a generic project manager. Its workflow checklist (contact the creator, ask for OK, send the contract, brief, video in store, publish) and its influencer pipeline are specific to how this team works. A generic Gantt or Trello board could not copy that.

## Operating Context

The current app has these views and must keep all of them ("proprio uguale", only better):

- **GANTT**: projects, tasks with status, assignees ("Who"), dates and end dates, labels, subtasks, backlog, a "tasks to approve" queue, zoom levels, a Today button, undo and history.
- **PED** (editorial plan): social posts with date, time, status, assignees, social network (Instagram, TikTok), format (Video, Static, Carousel), asset link, copy, comments with @mentions, subtasks. Hourly grid from 11:00 to 20:00.
- **INFLUENCER**: a table with search and filters (city, target, type, status, where, when), TikTok and Instagram profiles and links, output, price, contact date and person, per-type staffing progress.
- **CREATOR CALENDAR**: in-store video and publication dates per creator and store, with status and time.
- **BUDGET**: read-only dashboard of spending by month and category, loaded from a Google Sheet (see Capabilities and Constraints).
- **Settings** panels for assignees, statuses, labels, social networks and colored option lists for influencer fields.
- Unfinished tasks roll over to the next working day at 20:00 (latest behaviour in the repo history).
- Two-way sync across people and devices, with merge of simultaneous edits.

Reference copy of the current source for study: `scratchpad/orig` (a clone of the existing repo; not part of the new project).

## Capabilities and Constraints

- **Same data, same document.** The user chose to read and write the live Firestore document `boards/default` (shape: `{ data, history, revision, updatedAt }`; a safety copy at `boardSafety/latest`) from day one. The new app must therefore keep the data schema backward compatible, so the old site keeps working until it is retired. Because a development bug can damage real team data, the new app needs a safety backup before writes and a read-only mode while building.
- **Access.** One shared team login, as today (Firebase Auth email/password, account `team@otacos-workflow.app`). No per-person accounts. This means the app cannot know who made a change; assignee names are data, not identities.
- **Responsive, not two apps.** One codebase that works well on desktop and phone, and installs as a PWA. Reachable by link, no app store.
- **Language.** The interface is English only (user decision). That includes the labels that are Italian today (Contattare, Ask Ok Alice, Mandare contratto, Avvisare Giorgia, Mandare video ad Alice, Task da approvare, Progetti, Accesso, Sincronizzazione). Set `lang="en"`. Existing user data (task names, labels already stored in Firestore) is not translated or rewritten; only the interface text changes. Which English wording replaces the old Italian workflow labels is still to be agreed, because those strings are also stored as data in each task's checklist.
- **Budget source (read-only).** The Budget view reads the Google Sheet `10DAdDOdvTOiJWx-a8pP1DwigGyggWM3wDIhEUHFOG-Q` (https://docs.google.com/spreadsheets/d/10DAdDOdvTOiJWx-a8pP1DwigGyggWM3wDIhEUHFOG-Q/edit?gid=0). The current app fetches it unauthenticated from the browser: one CSV per month tab through the `gviz` endpoint (tab names like AUG26, JULY26, JUNE26, MAY26 and so on back to JUL25), plus an `export?format=xlsx` fallback. The sheet is not edited from the app. Each tab holds transactions and a forecast; categories seen in code are Influencer, Media, Events, Fee, General, Forecast. The new app must keep reading it the same way, and handle a tab that is missing, empty, or temporarily unreachable.
- **Second spreadsheet.** The Influencer view imports from another Google Sheet (`1l70YY3at2sBeIO9iET6bypMRxWkgVD8APzsQY7PhR7I`, CSV gid 429623991 and xlsx export). Keep this import; its exact columns are to be read from the existing code.
- **Open:** whether to keep the 7-step Gantt zoom list as is.

## Brand Commitments

Name "O'Tacos" (written O'TACOS in the header), shown with the existing logo (`otacos-logo.svg`) and the existing fonts Bricolage Grotesque and Switzer (woff2 files in the repo). The user has not said the current look must stay; only the brand name, logo and fonts are treated as binding assets.

## Evidence on Hand

- The live site above and its source (clone in `scratchpad/orig`), including `theme-otacos.css`, the logo files and the fonts.
- The Firebase web config is public in the page source (project `o-tacos-gantt`). Real team data is behind the login; I do not have the password and have not seen real data. Do not invent sample tasks, influencers, budget figures or people. Use clearly empty states or neutral placeholders.

## Product Principles

- **Same job, less friction.** Every current view and field stays reachable. Anything used daily takes fewer taps than today.
- **Phone first for the quick edits, desktop first for the planning.** Updating a status or adding a post must work one-handed on a phone. Wide timelines and tables can take the room of a desktop.
- **Never lose team data.** Backward-compatible schema, backups before writes, and a visible, honest sync state.
- **Calm over dense.** The team works all day in it. Structure and clarity beat decoration.

## Accessibility & Inclusion

"Accessible to everyone" was an explicit request: usable on any modern device and browser, with keyboard and screen-reader support and sufficient contrast. No formal standard has been named; WCAG 2.2 AA is the working target (an inference, not a user decision).
