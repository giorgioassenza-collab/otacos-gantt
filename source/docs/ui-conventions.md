# UI conventions for O'Tacos Workflow (read before writing any UI)

Read `PRODUCT.md` first. This is an **Operate** surface: a daily working tool for a small marketing team, used on desktop and on a phone. Interface text is **English only**.

## What already exists (reuse it, do not reinvent)

- Tokens: `src/styles/tokens.css` (colors, `--fs-1..6`, `--s-1..7`, radii, `--shadow-float`, `--ease`). Use the variables, never raw hex, except for user-chosen data colors (project/status/option colors come from the data).
- Base components CSS: `src/styles/base.css` (`.btn`, `.btn--primary|dark|ghost|danger|sm|block`, `.icon-btn`, `.input`, `.select`, `.textarea`, `.field`, `.check`, `.chip`, `.avatar`, `.segmented`, `.sheet`, `.menu`, `.toast`, `.empty`, `.skeleton`, `.spinner`).
- Shell CSS: `src/styles/shell.css` (`.view-toolbar`, `.view-scroll`, `.new-btn` = FAB on phones / primary button in the toolbar on desktop).
- Shared view CSS: `src/styles/views.css` (pills, `.subform`, `.row-2`, `.list-row`, `.notice`, ...). **Append your own view's CSS to `src/styles/views.css` under a clear comment header, prefixed with your view's class names** (e.g. `.inf-...`, `.cc-...`, `.bud-...`). Do not edit other sections.
- Components: `src/ui/Sheet.tsx` (`Sheet`, `SheetBody`: bottom sheet on phones, side panel on desktop, focus trap, Esc), `src/ui/Menu.tsx` (`useMenu`), `src/ui/Toast.tsx` (`useToast`), `src/ui/fields.tsx` (`TextField`, `TextAreaField`, `SelectField`, `CheckField`, `MultiPick`, `Field`), `src/ui/pills.tsx` (`PillRadio`), `src/ui/common.tsx` (`Avatars`, `StatusChip`, `EmptyState`, `Notice`), `src/ui/icons.tsx` (lucide icons: add exports there when you need a new one, keep one stroke weight), `src/ui/uiContext.tsx` (`useUI`: `open({kind...})`, `close()`, `go(view)`).
- Data/state: `useBoard()` from `src/store.tsx` gives `{ state, data, mutate, sync }`. **All writes go through `mutate((draft) => { ... })`** on a draft `BoardData`; never mutate `data` directly. Call `touchItem(item)` (src/data/merge.ts) on every task/post/influencer you change so the merge keeps your edit. Use the helpers in `src/data/labels.ts`, `src/data/merge.ts`, `src/lib/actions.ts`, `src/lib/gantt.ts` before writing new ones. The data layer is a faithful port of the old app: do NOT change anything in `src/data/` (another engineer owns it); ask in your report if something is missing.
- Reference implementations of the same patterns: `src/views/gantt/*` (toolbar, agenda cards, status menu), `src/views/ped/PedView.tsx` (responsive: list on phones, grid on desktop), `src/shell/sheets/TaskSheet.tsx` (editor sheet).
- The original app (read only) for behaviour reference: `C:\Users\Utente\AppData\Local\Temp\claude\C--Users-Utente-O-Tacos-gantt-claude\2466893e-2297-4ff5-8f89-eb6a0ce1a70d\scratchpad\orig\index.html` (Grep for function names).

## Responsive rules

- Phone first for quick edits, desktop first for planning. Breakpoints used across the app: `<720px` phone (bottom tab bar, FAB), `720–1099px` tablet (icon rail), `>=900px` wide layouts for grids/tables, `>=1100px` full rail.
- Every view must work at 375px wide with no horizontal page scroll (wide tables may scroll inside their own container, but prefer a card list on phones).
- Touch targets at least 40px (36px for dense secondary controls). Inputs are 16px font on phones (already in `.input`).
- Keyboard and screen reader: real `<button>`/`<label>`, visible focus (already themed), `aria-label` on icon-only buttons, `aria-pressed`/`aria-selected` on toggles, tables with proper `<th scope>`.
- Respect `prefers-reduced-motion` (base.css already neutralises animations).

## Design rules (house style)

- Palette is the O'Tacos brand: orange `--orange` is the action/selection color, ink `--ink`, warm paper surfaces. Orange as text on paper must use `--orange-ink`. Secondary text `--ink-3`, tertiary `--muted`. Body text contrast >= 4.5:1.
- Display font (`--display`, uppercase condensed) only for the topbar title, sheet titles, day/month headings and big numbers. Everything else Switzer via `--sans`. Use the 6-step type scale.
- Shadows only on floating layers (sheets, menus, toasts). Radii: `--r-sm` 6, `--r-md` 10, `--r-lg` 16.
- **Do not**: add kicker/eyebrow labels above headings; nest cards in cards; use gradient text; use a colored left/right border above 1px as a status stripe; use hard offset shadows; use emoji or unicode glyphs as icons (use lucide); use side-by-side identical icon+title+text card grids as page structure; use a modal for something that does not need to interrupt (prefer inline or a sheet).
- Every list/table needs a real **empty state** (what this is + the next action), a **loading** state if data is async, and an **error** state that names the problem and the recovery.
- Copy: controls name their action ("Add influencer", not "Submit"); errors say what happened and what to do. English only.

## Process rules

- TypeScript strict. After writing, run `npx tsc --noEmit` and fix every error in YOUR files (errors in files you do not own: report them, do not edit). PowerShell: `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","User") + ";" + [System.Environment]::GetEnvironmentVariable("Path","Machine")` before `npm`/`npx`.
- Do not run the dev server or take screenshots; do not git init/commit/push. Do not modify files you do not own (listed in your assignment) except appending your CSS block to `src/styles/views.css` and adding icon exports to `src/ui/icons.tsx`.
- Keep a compact final report: files created, public exports, behaviour NOT ported from the original and why, assumptions, anything the lead must wire up.
