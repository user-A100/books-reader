# Design — Books

This file records the existing desktop application's interface language. New
feature pages should feel native to Books rather than like standalone demos.

## Genre

Utilitarian desktop application.

## App-page structure

- Keep the existing 220 px sidebar and header relationship.
- Use a simple page title or a two-column master/detail layout when required.
- Functional pages do not use marketing heroes, slogans, decorative imagery,
  fake browser/terminal chrome, or oversized editorial typography.

## Theme

- Inherit the active light/dark skin from `public/assets/styles`.
- Primary actions use the active application theme colour.
- Surfaces are transparent by default; use the current hover colour for quiet
  selected and hover states.
- Borders use the application's low-contrast neutral rule.

## Typography

- Display and body: the system sans-serif stack already defined globally.
- Page title: 24–28 px, weight 600–700.
- Section title: 14–17 px, weight 600.
- Body and controls: 10–15 px according to density.
- Monospace is reserved for editable source code, never decorative labels.

## Spacing and shape

- Follow a 4 px base spacing scale.
- Inputs and ordinary cards use 5–6 px radii.
- Search fields may use the existing 22 px pill treatment.
- Dialogs use an 8 px radius and a restrained application shadow.

## Motion

- Hover and focus feedback only, 100–200 ms.
- No decorative entrance animation, floating cards, glow, parallax, or bounce.
- Respect reduced-motion preferences.

## Interaction voice

- Use direct feature names and action labels.
- Keep loading, empty, error, disabled, hover, active, and focus states visible.
- Prefer inline state changes and the application's existing toast behavior.

## What pages must share

- Sidebar position and active-state treatment.
- System typography and current application skin.
- Search, button, border, focus, spacing, and dialog conventions.
- Compact information density suitable for a desktop reader.

## Per-page allowances

- Open Library may show book covers.
- Book Sources may show its parsing steps and a source editor.
- Phone Connect may use a master/detail connection layout.
- Website Navigation may show a URL field and bookmark grid, without simulated
  browser decoration.

## Exports

The portable geometry and motion tokens are in `tokens.css`. Runtime colours
continue to come from the application's active light/dark skin.
