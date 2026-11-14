---
name: Gretlab
description: A coding lab and a school's working day on warm paper, with one orange for action.
colors:
  primary: "#f54e00"
  primary-active: "#d04200"
  canvas: "#f7f7f4"
  canvas-soft: "#fafaf7"
  card: "#ffffff"
  ink: "#26251e"
  body: "#5a5852"
  muted-foreground: "#807d72"
  muted-soft: "#a09c92"
  hairline: "#e6e5e0"
  hairline-soft: "#efeee8"
  hairline-strong: "#cfcdc4"
  success: "#1f8a65"
  destructive: "#cf2d56"
  amber: "#c98a1b"
typography:
  display-lg:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.72px"
  display-md:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "-0.325px"
  display-sm:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "-0.11px"
  title-md:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
  title-sm:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
  body-md:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  caption-upper:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.88px"
  button:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1
  nav:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
  code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.card}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary-active}"
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "40px"
  button-outline-hover:
    backgroundColor: "{colors.hairline-soft}"
  button-secondary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "40px"
  button-ghost:
    textColor: "{colors.body}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "40px"
  button-ghost-hover:
    backgroundColor: "{colors.hairline-soft}"
    textColor: "{colors.ink}"
  button-destructive:
    backgroundColor: "{colors.card}"
    textColor: "{colors.destructive}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "0 18px"
    height: "40px"
  button-sm:
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
    height: "36px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    padding: "20px"
  badge:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
    height: "20px"
  nav-item:
    textColor: "{colors.ink}"
    typography: "{typography.nav}"
    rounded: "{rounded.md}"
    padding: "8px"
  nav-item-active:
    backgroundColor: "{colors.hairline-soft}"
  table-header:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.caption}"
    padding: "10px 12px"
---

# Design System: Gretlab

## Overview

**Creative North Star: "The Lab Notebook"**

Gretlab looks like a well-kept notebook. The page is cream paper, ruled with hairlines rather than raised in layers. Writing is in warm ink. One orange marks the place to act: the primary button, the wordmark's `>>>` prompt, the first chart series. The same pages serve a principal reading the day's registers on a laptop and a parent checking attendance on a phone, so the system relies on clear rules and steady density, not decoration.

It's an Operate product almost everywhere: registers, gradebooks, marks entry, timetables, an editor. The design shows in exact things: tabular numbers that line up, a type scale with few steps used consistently, hairline tables, and status colours that mean one thing each. Expression stays small: the cream and ink warmth, the orange, and the mono prompt in the mark. Anything louder would compete with the data.

The look is decided. New work keeps this identity and improves layout, hierarchy and how data is shown inside it.

**Key Characteristics:**
- Warm cream canvas, white cards, warm near-black ink; never cool grey.
- One orange accent, kept for the action and the brand mark.
- Hairlines and rings define surfaces. Shadows are only for things that float.
- Light-weight display type, semibold titles, small captions; tabular numbers in data.
- Gently rounded (8px controls, 12px cards); pills only for badges and progress.
- Light and dark themes from the same tokens: the warm hues inverted, the same orange.

## Colors

A warm paper-and-ink neutral range with one saturated orange, plus three status colours that each mean one thing.

### Primary
- **Signal Orange** (`primary`): the primary button, the `>>>` in the wordmark, the first chart series, selected and current markers, and links that are the main action. It's the same in both themes.
- **Pressed Orange** (`primary-active`): hover and pressed state of orange surfaces, and orange text that has to read on cream (`text-primary-active`).

### Neutral
- **Lab Cream** (`canvas`): the page background and the sticky header. Dark: #171612.
- **Margin Cream** (`canvas-soft`): the sidebar's surface, one step lighter than the page. Dark: #1e1d18.
- **Sheet White** (`card`): cards, tables, popovers, dialogs, and the outline and destructive buttons. Dark: #201f1a.
- **Warm Ink** (`ink`): headings, figures, table cells, and the secondary (inverted) button. Dark: #edece4.
- **Pencil** (`body`): running text in cards and ghost buttons. Dark: #b8b5ab.
- **Faded Pencil** (`muted-foreground`): captions, labels, table headers, hints. Dark: #96938a.
- **Erased** (`muted-soft`): placeholders and the faintest metadata. Dark: #6f6c62.
- **Rule** (`hairline`): every border and divider; also the badge fill and the default `secondary` surface. Dark: #2f2e28.
- **Soft Rule** (`hairline-soft`): hover fills, the active sidebar item, the `muted` and `accent` surfaces. Dark: #292822.
- **Strong Rule** (`hairline-strong`): input borders and the outline button's border, which need to read as controls. Dark: #45433b.

### Status
- **Ledger Green** (`success`): passed, present, accepted, "good" figures. Dark: #4cc29a.
- **Correction Red** (`destructive`): errors, failing values, destructive actions, absent, below threshold. Dark: #f0708f.
- **Ochre** (`amber`, `--chart-4`): the fourth chart series and caution states between the two. Dark: #e3b25a.

Status colours appear mainly as text, or as a 5–10% tint behind text (`bg-success/10`, `bg-destructive/10`), rarely as solid fills.

### Named Rules
**The One Orange Rule.** Orange marks where to act or who we are. A view has at most one orange button. Orange is never a status colour: it doesn't mean "warning" or "late".

**The Warm Neutral Rule.** Every neutral comes from the cream–ink family. Don't bring in Tailwind's cool `gray`, `slate` or `zinc`, or pure black.

**The Tokens Only Rule.** Colour comes from the tokens (`bg-canvas`, `text-body`, `border-hairline`), never from fixed values, so both themes work without extra code.

## Typography

**Body and Display Font:** Inter (with ui-sans-serif, system-ui). It stands in for the licensed CursorGothic.
**Mono Font:** JetBrains Mono (with ui-monospace). Used for code, the editor, and the wordmark's prompt. Ligatures are off, so `!=` reads as typed.

**Character:** a neutral sans with light-weight displays and semibold titles. The contrast in weight, not size, sets the hierarchy, which keeps dense screens calm. Mono appears only where something is code.

### Hierarchy
- **Display** (400; 36 / 26 / 22px; line-height 1.2–1.3; slightly negative tracking): page titles. `display-lg` for the main heading of a home or landing view, `display-sm` for most page titles.
- **Title** (600; 18px and 16px; 1.4): section and card headings, figures in `Stats`. `title-sm` is the most common heading inside cards.
- **Body** (400; 16px and 14px; 1.5): `body-sm` (14px) is the working size for app screens, tables and forms; `body-md` for longer reading such as problem statements. Keep prose to about 65–75ch.
- **Caption** (400; 13px; 1.4): labels, table headers, hints, timestamps.
- **Caption upper** (600; 11px; 0.88px tracking; uppercase): rare group labels and eyebrows. Use it sparingly.
- **Code** (JetBrains Mono, 13px; 1.5): inline code, outputs, verdict details.

### Named Rules
**The Scale Only Rule.** Sizes come from the named scale (`text-display-sm`, `text-body-sm`, `text-caption`), not Tailwind's `text-sm` or arbitrary pixels. A new size is a new token in `globals.css` and in `cn()`'s font-size list.

**The Tabular Figures Rule.** Any number that's compared with another (marks, percentages, counts, times) is set with `tabular-nums` so columns line up.

## Layout

- **Frames.** Learn pages sit under one sticky 56px header (`page-header.tsx`) on the cream canvas. Working areas (an organization, the platform dashboard) use the `AppFrame` sidebar layout: the full sidebar from 1024px, an icon rail with tooltips from 768px, and a slide-out menu below.
- **Width.** Content columns are capped by purpose: `max-w-md`/`lg` for forms and dialogs, `max-w-2xl`/`3xl` for reading and settings, `max-w-5xl` for wide data pages. Tables scroll inside their card rather than widening the page.
- **Spacing.** The base unit is 4px. Most gaps are 8px (`gap-2`) and 12px (`gap-3`); 16px separates groups and pads compact cards; 20px pads the standard card. Density is moderate: tight inside a row, generous between sections.
- **Data screens.** A list's summary figures go in one line above it (`Stats`: hairline above and below, label over figure), not a row of tiles. Percentages in tables are `PercentBar`s. Long lists page on the server with the shared `Pager`.
- **Responsive.** Every screen works at 390px with no sideways page scroll. Tests check 1920, 1440, 834 and 390.

## Elevation & Depth

The notebook is flat. Surfaces are separated by hairlines, a 1px ring (`ring-1 ring-foreground/10`), and the change from cream to white, not by lifting. Resting cards and inputs may carry shadcn's faint `shadow-xs` (it's almost invisible on cream), and nothing heavier.

### Shadow Vocabulary
- **Rest** (`shadow-xs`): cards, tables and inputs, always together with a ring or border.
- **Float** (`shadow-md`, `shadow-lg`): popovers, dropdown menus, dialogs, sheets and toasts, which sit above the page.

### Named Rules
**The Only Floats Cast Shadows Rule.** If it stays in the page's flow, a hairline defines it. A shadow larger than `shadow-xs` means the element floats over the page and can be dismissed.

## Shapes

Gently rounded and consistent. Controls (buttons, inputs, selects, sidebar items) use 8px (`rounded-md`); small buttons and chips inside rows use 6px (`rounded-sm`). Cards, tables and dialogs use 12px (`rounded-lg`/`rounded-xl` in components). Full pills are only for badges, avatars, progress tracks and toggles. Borders are 1px everywhere. Focus is a 2px ink outline with a 2px offset, never a coloured glow.

## Components

### Buttons
Plain and exact: a clear label, a 40px height, and the colour saying how important it is.
- **Shape:** gently rounded (8px); small sizes 6px.
- **Primary:** Signal Orange with white text, 14px medium, 40px tall, 18px side padding. Hover and pressed go to Pressed Orange. One per view.
- **Secondary:** Warm Ink with cream text, for a strong action that isn't the main one.
- **Outline:** white with a Strong Rule border; hover fills Soft Rule. The default for most actions.
- **Ghost:** Pencil text, no fill; hover fills Soft Rule and darkens to ink. For toolbars and rows.
- **Destructive:** white with Correction Red text and a faint red border; it fills with a red tint on hover. Every destructive action asks first in an AlertDialog with a red button naming the action.
- **Sizes:** default 40px, `sm` 32px, `xs` 24px, plus square icon sizes.
- **Focus / Disabled:** a 2px ink outline, offset 2px; disabled is 50% opacity with no pointer events.

### Badges
- **Style:** a 20px pill, 12px medium. Default is orange for a selected or brand mark; `secondary` is a Rule fill for neutral counts and states; `destructive` is a red tint with red text; `outline` is a hairline.
- **Use:** short states and counts ("Draft", "Late", "3 new"). Never orange for a status.

### Cards / Containers
- **Corner Style:** 12px.
- **Background:** Sheet White on the Lab Cream page.
- **Shadow Strategy:** a 1px ring at 10% ink with at most `shadow-xs` (see Elevation).
- **Internal Padding:** 20px in the admin `Card`, 24px in the shadcn `Card` (16px at `size="sm"`).
- **Text:** `body-sm` in Pencil; headings in ink at `title-sm`.

### Tables
- Sit in a white, 12px, ringed container that scrolls sideways when it must.
- The header row is a faint muted fill with a hairline below, 13px Faded Pencil labels, 10px × 12px cells.
- The body is `body-sm` in ink; rows are separated by hairlines. Numbers are tabular and right-aligned where they're compared.

### Inputs / Fields
- **Style:** 36px tall, 8px radius, Strong Rule border, transparent on white (a faint ink tint in dark), 14px text, Erased placeholder.
- **Focus:** the border turns ink with a soft 3px ring.
- **Error / Disabled:** a red border and a faint red ring; disabled at 50%.
- Always the shadcn controls from `packages/ui` (through `components/form.tsx` in forms), never native elements.

### Navigation
- **Header:** sticky, 56px, cream with a hairline below: the wordmark, the organization switcher, the Learn/Teach toggle, the current mode's sections, then the bell, theme and account menu. Phones get a menu.
- **Sidebar:** Margin Cream, 14px medium items with 16px Phosphor icons, 8px radius. Hover and the active item fill Soft Rule, and the active item turns medium weight. Groups fold, and the choice is remembered.

### The Wordmark
A JetBrains Mono `>>>` in Signal Orange, then the site name in `title-sm` ink. It's the only place the prompt appears.

### Stats Line
The summary above a list: a hairline above and below, items spaced 32px apart. Each item has a caption label over a `title-md` tabular figure, which turns Ledger Green or Correction Red when it's good or bad. A figure with a link underlines on hover and leads to the detail behind it.

### Percent Bar
An 80 × 6px pill track in Rule fill. The bar is 70% ink, or Correction Red below the threshold (40% by default), followed by the rounded percentage in a 40px tabular column.

## Do's and Don'ts

### Do:
- **Do** use the tokens (`bg-canvas`, `bg-card`, `text-ink`, `text-body`, `border-hairline`) so light and dark both work.
- **Do** keep orange to one primary action per view and the brand mark.
- **Do** separate surfaces with hairlines and a 1px ring; leave shadows to popovers, menus and dialogs.
- **Do** set numbers that are compared with `tabular-nums`, and show percentages in tables as `PercentBar`s.
- **Do** put a list's figures in one `Stats` line above it, each leading to the detail behind it.
- **Do** use the named type scale and keep `text-body-sm` (14px) as the working size of app screens.
- **Do** check new shadcn registry components in both themes; they sometimes arrive with forced colours.

### Don't:
- **Don't** use Tailwind's cool greys (`gray`, `slate`, `zinc`) or pure black; neutrals are warm.
- **Don't** use orange for warnings, lateness or any status; status is green, red or ochre.
- **Don't** put a row of figure tiles above a list where one `Stats` line will do.
- **Don't** give in-page surfaces shadows heavier than `shadow-xs`.
- **Don't** use native `<button>`, `<input>`, `<select>`, `<textarea>` or hand-made popups; use the `packages/ui` components.
- **Don't** use Tailwind's `text-sm`/`text-lg` or arbitrary pixel sizes where a named token exists.
- **Don't** show the `>>>` prompt anywhere but the wordmark.
