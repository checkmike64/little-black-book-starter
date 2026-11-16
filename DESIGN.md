---
name: Little Black Book — Black Morocco
description: A private working book bound in tactile black bookcloth around cool mineral-blue working leaves.
colors:
  matte-black: "#0b0b0a"
  indexed-black: "#151513"
  mineral-blue: "#eaf3f4"
  optic-paper: "#f7fbfa"
  soft-paper: "#edf4f4"
  ledger-ink: "#111412"
  quiet-ink: "#52666b"
  muted-ink: "#617277"
  hairline: "#adbec1"
  strong-rule: "#7f9499"
  silver: "#91a1a5"
  cobalt: "#0b56c7"
  cobalt-pressed: "#063c91"
  success: "#2e7450"
  danger: "#853d3d"
typography:
  display:
    fontFamily: 'Baskerville, "Iowan Old Style", var(--font-ledger-serif), "Palatino Linotype", Palatino, Georgia, serif'
    fontSize: "clamp(3rem, 6vw, 4.75rem)"
    fontWeight: 400
    lineHeight: 0.98
    letterSpacing: "-0.025em"
  body:
    fontFamily: '"Avenir Next", Avenir, var(--font-ledger-text), "Segoe UI Variable", "Segoe UI", "Helvetica Neue", Arial, sans-serif'
    fontSize: "14px"
    lineHeight: 1.55
  label:
    fontFamily: '"Avenir Next Condensed", var(--font-ledger-utility), "Arial Narrow", "Segoe UI", sans-serif'
    fontSize: "10px"
    fontWeight: 500
    letterSpacing: "0.12em"
rounded:
  folio: "0"
  field: "1px"
  control: "2px"
spacing:
  control-inline: "14px"
  folio-gap: "24px"
  content-inline: "34px"
  heading-inline: "44px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-primary-active:
    backgroundColor: "{colors.cobalt-pressed}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-ghost:
    backgroundColor: "{colors.optic-paper}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  folio:
    backgroundColor: "{colors.optic-paper}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.folio}"
  field:
    backgroundColor: "{colors.optic-paper}"
    textColor: "{colors.ledger-ink}"
    rounded: "{rounded.field}"
---

# Design System: Little Black Book — Black Morocco

## Overview

**Creative North Star: "Black Morocco"**

Black Morocco treats the application as a carefully bound private working book, not a public SaaS dashboard. A visible black bookcloth binding establishes privacy and authority around pale mineral-blue working leaves; precise rules organize dense relationship context without dashboard theatre. Texture belongs to the binding, never to the records themselves.

The expression is serif-led but operational. Editorial titles, quiet text navigation, and lightly embossed controls evoke carefully made desktop software without nostalgic ornament. The screen should feel composed, quiet, and exact rather than luxurious, playful, or automated.

**Key Characteristics:**

- Tactile black bookcloth binding around cool mineral working leaves.
- Optic-white, square-cornered folios divided by fine rules rather than floating cards.
- Baskerville-led titles, restrained sans-serif working text, and condensed index labels.
- Text-only navigation with counts shown only when work is waiting.
- Cobalt reserved for action, selection, focus, and small registration marks.
- Delicate embossed controls set against otherwise flat surfaces.

## Colors

The palette is cool, mineral, and high-contrast: black indexing, blue-grey paper, optic folios, dark ink, silver rules, and one precise cobalt signal.

### Primary

- **Registration Cobalt:** The sole action accent. Use it for primary controls, current-position terminals, pending counts, text selection, carets, focused fields, active tab rules, and tiny registration marks.
- **Pressed Cobalt:** The deeper active-state endpoint for primary controls and strong accent borders.

### Neutral

- **Matte Black:** The textured application binding, signed-out surround, stat bands, and numbered ledger tabs. Page headings stay on the mineral leaf.
- **Indexed Black:** The selected dark navigation row and subdued black-on-black layering.
- **Mineral Blue:** The main canvas and inset review/work areas; it should read as cool paper, never as a tinted card effect.
- **Optic Paper:** The canonical folio, table, queue, and continuous-list surface.
- **Soft Paper:** Notices and quiet tonal separation where a rule alone is insufficient.
- **Ledger Ink:** Primary text on paper.
- **Quiet and Muted Ink:** Secondary copy, explanations, and low-emphasis labels while retaining accessible contrast.
- **Hairline and Strong Rule:** The two-level divider system: ordinary internal rules and stronger folio boundaries.
- **Silver:** A restrained utility neutral, not a metallic decoration.

### Tertiary

- **Success:** Use only for genuine positive state semantics.
- **Danger:** Use only for destructive or error semantics; it is not a decorative counter-accent.

### Named Rules

**The One Cobalt Rule.** Cobalt is the only expressive hue and must stay scarce; it marks action or current state rather than filling large surfaces.

**The Alias Without Drift Rule.** Legacy `gold`, `oxblood`, and related class aliases resolve to the current cobalt or neutral palette for compatibility. Their names are not permission to restore beige, gold, burgundy, or warm luxury styling.

**The Paper Is Cool Rule.** Backgrounds stay mineral blue, optic white, or neutral black. Never warm the system toward parchment, cream, or sepia.

## Typography

**Display Font:** Baskerville, then Iowan Old Style, self-hosted Baskervville, Palatino, and Georgia fallbacks.

**Body Font:** Avenir Next/Avenir, then self-hosted Manrope, followed by Segoe UI Variable, Segoe UI, Helvetica Neue, Arial, and sans-serif.

**Label Font:** Avenir Next Condensed, then self-hosted Barlow Condensed, followed by Arial Narrow, Segoe UI, and sans-serif.

**Self-hosted assets:** `Baskervville-Variable.ttf` supplies the ledger serif at weights 400–700; `Manrope-Variable.ttf` supplies working text at weights 200–800; Barlow Condensed is supplied by Regular, Medium, and SemiBold files at weights 400, 500, and 600. All load with `display: swap` through `next/font/local`. Preserve both the local files and the exact fallback order: the stacks intentionally prefer select platform faces before the bundled assets.

**Character:** The serif carries ownership, names, and chapter gravity. The sans-serif carries useful working context. The condensed utility face behaves like an index: small, firm, tracked, and subordinate.

### Hierarchy

- **Display** (400, fluid 2.6–3.9rem, 0.98 line-height, -0.025em): Page titles and other decisive chapter headings; at narrow widths it shifts to a 2.25–3.25rem fluid range.
- **Title** (400): Wordmark titles, card headings, people names, meeting titles, and section headings use the serif without synthetic boldness.
- **Body** (14px where specified, 1.55 line-height): Ledes and working prose prioritize compact readability.
- **Navigation** (12px, 0.035em tracking): Owner and operator destinations are calm, compact, and never promotional.
- **Label** (typically 9–10px, 500, 0.06–0.16em tracking): Crumbs, section labels, field labels, table headings, status labels, and metadata. Uppercase is appropriate only when the existing label pattern uses it.

### Named Rules

**The Serif Has Authority Rule.** Reserve the serif for identity, names, and headings; controls, body copy, and operational metadata remain sans-serif.

**The Index Is Not a Kicker Rule.** Condensed labels identify structure or data. Do not invent promotional eyebrows above headings or turn every section into tracked uppercase decoration.

## Layout

The desktop shell is a two-column binding-and-leaf system: a 252px bookcloth sidebar, including a dark bound edge, beside a flexible mineral-blue main region. Content uses responsive 28–66px horizontal gutters and 70px bottom space. Page headings remain on the leaf with a strong baseline, at least 222px of breathing room, and no black banner behind the title.

The sidebar begins with the `Little Black Book` wordmark. Each owner navigation row contains one plain-language label and, only when useful, a small pending count. It contains no chapter number, glyph, terminal, or decorative badge. Operator tools remain subordinate inside the Management disclosure; never flatten operator destinations into the owner's main book.

Folios are continuous registers, not collections of floating tiles. Adjacent records share an outer boundary and are separated by single horizontal or vertical rules. Tables, person columns, meeting lists, recording sources, toggles, and engagement queues all follow this sheet-and-rule grammar. Repeated data may use compact 22–26px square index markers, but not circular badges.

Responsive behavior is explicit:

- **At 1050px and below:** the binding narrows from 252px to 220px; four-column recording sources become two columns with corrected internal rules.
- **At 900px and below:** the binding becomes a textured top index with a dark lower bound edge; navigation changes to a horizontally scrollable 50px row; the spine sheen and signed-in account disclosure hide; Management opens as a second horizontal strip. Main gutters reduce to 24px. Recording sources stack to one column and contact tables become ruled records.
- **At 760px and below:** titles use the narrower fluid scale; controls reach touch-safe heights (44px standard, 40px small); dense actions reflow to two columns or full-width rows; engagement folio insets tighten.
- **At 390px and below:** main gutters reduce to 14px and heading insets to 20px; calendar action groups collapse to one column. The system must remain usable down to 320px.
- **Reduced motion:** spatial movement and smooth scrolling are removed. Brief opacity and color feedback remains so state changes are still clear.

**The Navigation Before Content Rule.** The shell tells the owner where they are with a plain-language label and a restrained active state. It does not duplicate meaning with numbers, icons, or ornamental markers.

**The Cloth Stays Fine Rule.** On desktop, render the bookcloth at a fixed fine scale independent of the sidebar's height, with enough black veiling that the weave is sensed before it is seen. Never use `cover` on a tall desktop binding: it enlarges the weave into a decorative pattern. The shallow mobile top index may retain its cover crop.

**The Continuous Folio Rule.** When items belong to one register, use one outer sheet and internal rules. Do not split siblings into individually rounded, floating cards.

**The Single Boundary Rule.** Every rule must describe a real edge, division, or state. Never place parallel rules around an empty gutter, and never retain spacing for a marker that is no longer rendered. A folio owns its outer boundary; its records add only the dividers between them.

## Elevation & Depth

The system is flat by default. Folios, cards, queues, tables, notices, and status markers use tonal contrast and 1px rules with no shadow. Depth is reserved for controls and the faint edge sheen where the black index meets the mineral canvas.

### Shadow Vocabulary

- **Pale embossed control** (`inset 0 1px 0 rgb(255 255 255 / 94%), inset 0 -1px 2px rgb(39 52 56 / 8%), 0 1px 2px rgb(28 38 41 / 6%)`): Default neutral and ghost controls only.
- **Cobalt embossed control** (`inset 0 1px 0 rgb(255 255 255 / 28%), inset 0 -2px 3px rgb(0 0 0 / 20%), 0 1px 2px rgb(0 0 0 / 10%)`): Primary actions only.
- **Pressed control** (`inset 0 2px 4px rgb(31 45 49 / 16%), inset 0 -1px 0 rgb(255 255 255 / 70%)`): Neutral active state, paired with a 1px downward translation; cobalt controls use a deeper inset press.
- **Dark-shell control** (`inset 0 1px 0 rgb(255 255 255 / 7%), inset 0 -1px 2px rgb(0 0 0 / 24%)`): Quiet controls shown inside the black sidebar.
- **Index edge sheen** (`linear-gradient(90deg, transparent, rgb(255 255 255 / 6%), transparent)`): A 16px non-interactive seam centered just outside the desktop sidebar; remove it when the sidebar becomes a top index.

**The Depth Belongs to Action Rule.** A resting information surface is flat. Use embossing only where pressability must be communicated.

**The Delicate Press Rule.** Control depth stays inset, low-contrast, and short-range. Never replace it with heavy drop shadows, hard offsets, glowing halos, or neobrutalist slabs.

## Motion and Loading

Motion explains state; it never decorates navigation. Controls acknowledge a press immediately, the existing shell remains stable while the next page is prepared, and loading placeholders resemble the folio structure that will replace them.

- **Press feedback:** 100ms.
- **State feedback:** 160ms.
- **Overlays:** 200ms.
- **Easing:** `cubic-bezier(0.16, 1, 0.3, 1)`.
- **Route changes:** preserve the index and current folio until the next server-rendered view is ready. Do not choreograph full-page slides, scaling, or ornamental fades.
- **Pending actions:** every owner action that waits on the server must immediately disable its control and show a plain present-participle label such as `Saving…` or `Approving…`.
- **Reduced motion:** remove translation and scaling, but retain short opacity and color feedback.

**The Context Must Not Blink Rule.** Loading may replace incomplete content, but it must not erase the index or flash marketing-like interstitial copy.

**The Interface Answers Immediately Rule.** A press changes the pressed control before any network result arrives. Long work must never leave a visually unchanged control behind.

## Shapes

The form language is square and precise without becoming brutalist. Folios, stat bands, counts, index markers, and navigation rows use square corners (0). Fields and small status tags may soften by 1px. Pressable controls alone may use a delicate 2px radius. Borders are fine, cool-grey rules; silhouettes remain rectilinear.

The wordmark is plain text, not an avatar or logo badge. Pending counts and status marks remain compact and nearly square even when inherited class names call them pills.

**The Two-Pixel Ceiling Rule.** Do not exceed the shipped 2px control radius in core product UI. Rounded cards, capsules, and soft SaaS containers break the ledger world.

## Components

### Buttons

- **Shape:** Lightly softened square control (2px radius), 36px minimum desktop height, 11px medium text, and 14px horizontal padding. Small controls use 29px height and 9px inset.
- **Primary:** Cobalt field, white text, darker cobalt border, and a restrained inset emboss. Hover brightens slightly; active deepens to pressed cobalt with an inset depression.
- **Ghost:** Pale control face with dark ink and the same delicate raised edge.
- **Quiet:** Recessed blue-grey face and muted ink. Inside the black shell, all quiet/ghost controls switch to a near-black face with a subtle dark emboss.
- **Focus:** Every control receives a 2px cobalt outline with a 3px offset. Disabled controls lose their shadow, remain untransformed, and use 0.48 opacity.
- **Responsive:** At 760px and below, standard controls become 44px high and small controls 40px high. Action groups may fill available width.

### Fields

- **Style:** Near-white paper fill, strong-rule border, ledger ink, and a 1px corner softening.
- **Focus:** Border becomes cobalt and gains an inset 1px cobalt ring; the global 2px/3px-offset focus indicator remains the keyboard-visible contract.
- **Native controls:** Checkboxes and radio controls use cobalt as their accent color.

### Cards / Containers

- **Corner Style:** Square (0).
- **Background:** Optic paper for canonical folios; mineral blue for inset review work; black only for index bands and stat registers.
- **Shadow Strategy:** None. Separation comes from the two-level rule system and controlled tonal fields.
- **Border:** One strong outer rule around a register, then hairline internal divisions. Avoid double borders between adjacent items.
- **Internal Padding:** Contextual and compact; repeated work queues commonly use 20–26px insets rather than oversized dashboard padding.

### Status Tags and Counts

- **Style:** Compact, near-square, utility-type markers with 1px corners and restrained tracking. Neutral tags use cool grey paper and rules; current or pending state may use cobalt.
- **Constraint:** Keep them sparse and semantic. An inherited `.pill` class does not authorize capsule geometry or pill-heavy layouts.

### Navigation

- **Structure:** Every owner destination owns one concise text label and an optional pending count. Current routes use `aria-current="page"`.
- **Default / Hover / Active:** Quiet grey on matte black; hover moves to white; active adds a restrained indexed-black fill and white text.
- **Icons:** Do not add navigation icons, chapter numbers, terminals, or decorative markers. A label should carry the full meaning.
- **Management:** Preserve the disclosure grouping and role/setup visibility rules. On narrow screens its links become a second scrollable black strip.

### Ruled Folios

Meeting timelines, engagement sets, person columns, recording-source registers, mini-lists, toggle lists, and data tables all use the same compositional idea: one optic-paper sheet, a strong outer rule, and hairline divisions between records. Route-specific cobalt 5px registration squares or black 22px number tabs may identify position, but they must not turn each record into a decorative card.

## Do's and Don'ts

### Do:

- **Do** preserve the approved type pairing, spacing balance, text-only navigation, sparse cobalt action details, and delicate control depth.
- **Do** keep owner navigation primary and operator tools visually and structurally subordinate.
- **Do** preserve all current content, routes, actions, authentication behavior, role visibility, data semantics, and human approval flows when extending the interface.
- **Do** use accessible contrast, the cobalt 2px focus outline with 3px offset, touch-safe mobile control heights, reduced-motion behavior, and layouts that hold at 320px.
- **Do** use a strong outer boundary and hairline internal rules to make dense relationship information readable as one folio.
- **Do** give every new destination one clear text label and no redundant ornament.

### Don't:

- **Don't** introduce beige, parchment, cream, gold, burgundy, or warm luxury styling; legacy token names are compatibility aliases, not palette direction.
- **Don't** create generic AI/Claude-like surfaces, sparkle motifs, gradient automation cards, assistant avatars, or decorative AI iconography.
- **Don't** use stock icon navigation, mismatched icon packs, filled pictograms, or rounded icon badges.
- **Don't** build a pill-heavy dashboard, float every item in a rounded card, or use large radii anywhere in the core product.
- **Don't** add heavy shadows, hard-edged brutalist offsets, thick borders, or exaggerated press effects.
- **Don't** imitate Squarespace-style boxed or underlined templates. Rules here express ledger structure; they are not generic decoration around isolated modules.
- **Don't** trade privacy, explicit owner judgment, or existing relationship-data semantics for visual simplification.
