# DESIGN.md

Mode: Operate · Feel: exact, calm, desk-like · Focal point: the offers blotter and the arb column; in the book, the timeline

Idea: a price-assessment sheet and a trader's blotter laid over a voyage chart. Laycans,
pricing windows and voyages share one time axis, because timing is where the money is.

## Tokens (`apps/web/src/styles.css`, `:root`)

| Token | Value | Use |
|---|---|---|
| `--ink` | `#1b1d1f` | text |
| `--muted` | `#6a6e72` | secondary text, axis labels |
| `--faint` | `#9a9da0` | disabled, hints |
| `--line` | `#dcdad3` | dividers, table rules |
| `--line-2` | `#ebe9e3` | row rules |
| `--canvas` | `#f3f2ee` | page background (paper) |
| `--surface` | `#ffffff` | panels |
| `--surface-2` | `#f8f7f4` | selected or expanded rows, input fill |
| `--accent` | `#1f4e79` | primary action, selection, physical P&L, your positions |
| `--accent-soft` | `#e4ebf2` | selection background |
| `--ok` / `--bad` / `--warn` | `#1e7b4f` / `#b3261e` / `#a15c00` | signed changes, P&L, status only |
| `--sea` / `--land` / `--coast` | `#e2e9ee` / `#f3f2ee` / `#c9cdcf` | map |
| `--paper` | `#8a8d90` | paper (futures) P&L: grey, context |

## Type

IBM Plex Sans (self-hosted, 400 / 600). IBM Plex Mono only for codes: deal and voyage IDs,
route codes (TC14), contract codes (HOZ26), seeds. Sizes 12 / 13 / 14 / 16 / 20 (start title 28).
Tabular figures on every number; true minus sign (−); units in column headers, not in cells.
Sentence-case labels; no uppercase or letter-spaced labels.

## Space and shape

Spacing 4 8 12 16 24 32 48. Radius 4 px (inputs, buttons), 0 on panels joined by hairlines.
Elevation: borders only (dialogs and the toast are the only shadows).

## Rules

- Tables over cards. One row per offer, position, route; detail opens in the row, actions sit in the row.
- Colour means something: one accent for the primary action and selection; green and red only on signed numbers and status. No coloured side stripes, no pills; status is a dot plus a word.
- Labels over sentences. Arb shown as arithmetic, stages as a step bar, help in the manual and in closable one-line tips.
- One primary button per view ("Next week" in the top bar; "Buy + ship" on the best route of a row).
- Works at 390 px: tables scroll inside their own box, the top bar wraps, nothing scrolls the page sideways.
