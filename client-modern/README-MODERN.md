# SmartSpare ERP - Modern UI (client-modern)

Same backend and the same shell contract as `client/` (see `README-SHELL.md`), re-skinned as a 2025/26 SaaS-style app.
Vite dev server: **http://localhost:5174** (API proxied to :4000). Classic UI: `VITE_CLASSIC_URL` (default http://localhost:5173).

## Layout
Collapsible left **Sidebar** (modules = accordion, ribbon groups = sub-headings, built from `src/ribbon/ribbonConfig.ts`; collapses to an icon rail with tooltips and flyout menus; state persisted) +
**Topbar** (breadcrumb, Ctrl/Cmd+K **command palette**, "+ New" quick-create, pending-approvals bell, theme menu, user menu with Change password / Classic UI / Log out) +
**TabBar** (pill tabs, pin/close/middle-click/context menu/Ctrl+Shift+T/dirty dot/favourites; screens stay mounted) + **Workspace**.
Files: `src/components/shell/{Shell,Sidebar,Topbar,TabBar,Workspace,CommandPalette,GlobalSearch,nav}.tsx`.
`nav.ts` holds `QUICK_GROUPS` (the "New ..." actions used by the topbar menu, palette and Quick Actions screen) and flattened nav entries.

## Design tokens (tailwind.config.js + CSS variables in src/index.css)
Colours are `rgb(var(--token) / <alpha-value>)`, so opacity modifiers work (`bg-brand/10`). Light values in `:root`, dark in `.dark`.

| Tailwind class | Meaning |
|---|---|
| `bg-canvas` | app background |
| `bg-surface` / `bg-surface-2` / `bg-surface-3` | cards, inputs / subtle, zebra, table header / hover, chips |
| `border-line` / `border-line-strong` | hairline / stronger borders |
| `text-ink` / `text-ink-muted` / `text-ink-faint` | primary / secondary / disabled text |
| `bg-brand` `text-brand` `border-brand` `ring-brand` | accent (indigo, lighter in dark) |
| `bg-brand-soft` `text-brand-ink` `bg-brand-dark` | tinted bg / text on soft / hover |
| `bg-success-soft text-success`, `warning`, `danger`, `info` | semantic soft pills / text |
| `shadow-card` `shadow-pop` `rounded-card` (12px) | elevation + radius |
| legacy aliases | `bg-app-bg`, `bg-app-head`, `border-app-border`, `bg-brand-light`, `text-brand-dark`, `brand-mid` |

Helper classes: `.ctl` (input, h-9), `.tb-btn`, `.pg-btn`, `.grid-th`, `.grid-td`, `.card`, `.kbd`, `.menu-item`, `.skeleton`.
Fonts: Inter Variable (`@fontsource-variable/inter`), base text 14px, tables 13px.

## Theme system
`useUi().theme` = `light | dark | system` (persisted in `ss-ui`). `applyTheme()/initTheme()` in `src/store/ui.ts` toggle the `dark` class on `<html>`
(an inline script in `index.html` applies it before first paint). `ThemeMenu` (Topbar) is the switcher.
**Compatibility layer** at the bottom of `index.css` remaps hard-coded Tailwind classes (`.dark .bg-white`, `text-slate-*`, `border-slate-*`, `bg-red-50`, ...) so un-migrated screens stay readable in dark mode. Prefer tokens in new code.
Charts (Recharts) cannot use CSS variables: use `useChartTheme()` (`src/hooks/useChartTheme.ts`) for hex colours.

## Components (same props as the classic kit)
`@/components/ui`: Button, IconButton, Input/NumberInput/DateInput/Textarea/Select/Checkbox/Field, Badge/StatusBadge (soft pill + dot), Modal/ConfirmDialog, Toaster, Tabs, Toolbar, SectionHeader, Panel, Skeleton, LoadingBlock, EmptyState, ErrorState.
New additions: `Menu / MenuItem / MenuSep / MenuLabel` (popover menu), `PageHeader` (icon chip + title + actions for utility screens).
`DataTable`: card container, search, filter chips, column menu, export menu, **density toggle** (compact/comfortable, persisted in `ss-ui.density`), skeleton rows, sticky header, pagination footer. The column-filter row is hidden by default (Filters button).
`DocumentLayout`: page header with doc no + status pill + actions (primary action right-most; when more than 4 secondary `DocAction`s are given, extras collapse into a "More" menu). `HeaderSection` / `DocSection` / `NotesSection` render as cards; `TotalsSection` is a summary card; `DocumentFlow` is a stepper; `LineItemsGrid` keeps inline editing + keyboard behaviour.

## Adding a screen
Nothing changed: create `src/screens/<area>/foo.screen.tsx` exporting `ScreenDef[]`, add a ribbon entry in `ribbonConfig.ts` (it appears in the sidebar and the palette automatically). Use `DataTable` / `DocumentLayout` / `MasterDataScreen`, root element `h-full`; for free-form pages use `mx-auto max-w-[1400px] p-6` + `PageHeader`.

## Visual checks
`node scripts/shots.cjs light|dark` (needs global Playwright + Chrome/Edge, dev server on 5174, API on 4000) writes PNGs to `screenshots/`.
