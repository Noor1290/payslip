# Design system (shared with Payroll Hub)

The payslip app must look like the other apps in the Payroll Hub from the first screen, so it starts from these tokens instead of being restyled later. Dark is the default; light follows the OS or `data-theme="light"`. Components use only these tokens, never raw hex values. Fonts and icons are bundled locally (Geist, Geist Mono, lucide-react): no requests to outside servers.

**Exception: the payslip page itself.** The preview of the document, and the PDF and Excel files, are a picture of paper. They keep their own paper look (white page, serif font, the template's colours) in BOTH themes. No blur, glow, tint, overlay or colour filter on or behind the page, and the aurora background is not shown behind the preview.

## Tokens and components

Dark theme is the default. Light theme applies when the OS asks for it, or when
`data-theme="light"` is set on the root. Components must only use these tokens,
never raw hex values. The theme is decided inside this app (OS setting or its own
`data-theme`); do not try to sync it with Payroll Hub, since that would need bridge changes.

```css
:root {
  color-scheme: dark;
  --canvas: #070b14;          /* page background */
  --elevated: #0d1424;        /* dialogs, menus, sticky table headers */
  --surface: rgb(148 170 215 / 0.055);   /* cards, inputs, secondary buttons */
  --surface-hover: rgb(148 170 215 / 0.1);
  --line: rgb(148 170 215 / 0.14);       /* borders */
  --line-strong: rgb(148 170 215 / 0.28);
  --fg: #e9eef8;              /* main text */
  --muted: #a3b0c8;           /* secondary text */
  --subtle: #7c8dab;          /* placeholders, hints */
  --accent: #2dd4a7;          /* teal: primary actions, active state */
  --accent-hover: #4be0b8;
  --accent-fg: #03241b;       /* text on accent */
  --warn: #f5b544;
  --danger: #fb7185;
  --glow: #8b7cf6;            /* violet: secondary highlight */
  --sky: #5aa9ff;
  --aurora-a: rgb(45 212 167 / 0.16);
  --aurora-b: rgb(139 124 246 / 0.14);
  --aurora-c: rgb(56 132 255 / 0.1);
  --inner-glow: inset 0 1px 0 0 rgb(255 255 255 / 0.06);
  --shadow-pop: 0 24px 60px -20px rgb(0 0 0 / 0.7);
}
/* Light: same names, applied for prefers-color-scheme: light (when no data-theme
   is set) and for :root[data-theme="light"] */
:root[data-theme="light"] {
  color-scheme: light;
  --canvas: #f3f5fa;  --elevated: #ffffff;
  --surface: rgb(255 255 255 / 0.72);  --surface-hover: rgb(13 22 38 / 0.05);
  --line: rgb(13 22 38 / 0.1);  --line-strong: rgb(13 22 38 / 0.22);
  --fg: #0d1626;  --muted: #46546e;  --subtle: #5c6b87;
  --accent: #077a5f;  --accent-hover: #066a52;  --accent-fg: #ffffff;
  --warn: #96590a;  --danger: #be123c;  --glow: #6453c9;  --sky: #1d6fd1;
  --aurora-a: rgb(7 122 95 / 0.12);  --aurora-b: rgb(100 83 201 / 0.1);
  --aurora-c: rgb(56 132 255 / 0.08);
  --inner-glow: inset 0 1px 0 0 rgb(255 255 255 / 0.8);
  --shadow-pop: 0 24px 60px -24px rgb(13 22 38 / 0.28);
}
```

**Type.** Geist Variable for text, Geist Mono Variable for every number, id, date
and code (with `font-variant-numeric: tabular-nums`). Font features "ss01", "cv11",
antialiased. Page titles 24-30px semibold with tight tracking; section headings
16px semibold; body 14-15px; labels and hints 12-14px in `--muted`.

**Background.** `--canvas` with a very faint grid and two or three large, soft,
blurred colour washes (the aurora colours) drifting slowly behind the content.
Subtle: it should read as depth, not decoration.

**Cards ("glass").** `background: var(--surface); border: 1px solid var(--line);
box-shadow: var(--inner-glow); backdrop-filter: blur(18px) saturate(140%);`
with a 16px radius. A card has a header row (title left, action right) separated
by a 1px `--line` border, then its content.

**Buttons.** 8px radius, 14px medium text, 40px tall (32px small), 16px icons with
an 8px gap, and they move down 1px when pressed.
- Primary: `--accent` background, `--accent-fg` text, with a soft accent-coloured
  glow underneath (`0 0 0 1px var(--accent), 0 8px 24px -10px var(--accent)`).
- Secondary (the default): `--surface` background, `--line` border, inner glow;
  border becomes `--line-strong` on hover.
- Ghost: no background, `--muted` text, `--surface-hover` on hover.
- Danger: `--danger` text on a 10% danger tint with a 40% danger border.

**Inputs.** 44px tall, 8px radius, `--line` border on a slightly darker fill,
inner glow, `--subtle` placeholder. On focus the border turns `--accent`; when
invalid it turns `--danger` with the message underneath in `--danger`. Every input
has a visible label above it; optional fields say "(optional)" in `--subtle`.

**Badges.** Small uppercase pills (11px, medium, slight letter-spacing, fully
rounded) with a 30% border and 10% tint of their colour: accent for good/active,
warn for draft/attention, danger for errors, neutral for everything else.

**Icon tiles.** Icons sit in a 44px rounded square (12px radius) tinted with ~14%
of their colour and a ~35% border of the same colour. Use lucide icons, 1.5-2px
stroke, bundled with the app.

**Tables.** Sticky header on `--elevated`, 12px medium `--muted` column titles,
1px `--line` row borders, `--surface-hover` on row hover, numbers right-aligned
in the mono font. The table scrolls inside its card; the page does not.

**Dialogs.** Centred, `--elevated`, 16px radius, `--line-strong` border,
`--shadow-pop`, over a 60% black blurred overlay. Header is a 44px round tinted
icon, a title and a one-line description. Actions bottom-right: Cancel
(secondary) then the main action (primary or danger).

**States.** Every area that loads data needs all three:
- Loading: shimmering skeleton blocks in the shape of the content, not a spinner.
- Empty: a centred small illustration or tinted icon, a short title, one sentence,
  and the action that fixes it.
- Error: a danger-tinted panel with an icon, what happened in plain words, what to
  do about it, and a "Try again" button when retrying could help.

**Motion.** Short and calm: 150ms colour and border transitions, cards lift 2px on
hover, content fades and rises slightly when a screen opens. Respect
`prefers-reduced-motion` by turning all of it off.

**Accessibility.** WCAG AA contrast in both themes, a visible 2px accent focus
ring on everything focusable, full keyboard operation, real labels on every
control, and never colour as the only signal (pair it with text or an icon).

**Writing.** Plain, short sentences. Say what happened and what to do next.
No jargon, no exclamation marks.