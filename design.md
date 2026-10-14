# Deal&Drive design system

## Direction
Luxury motorsport. Graphite, silver and racing orange. Atmospheric campaign pages,
precise workspaces, readable long-form content. Original automotive campaign imagery
is decorative only; vehicle and uploaded media always come from existing services.

## Structure
- Marketing: wide campaign hero, editorial process rows, split media story, strong closing action.
- Application: permanent desktop navigation rail, compact context bar, generous workspace canvas.
- Conversations: contained conversation workbench with history, thread and composer.
- Forms: clear numbered chapters with an independent summary rail where available.
- Details: media-led main column and a persistent decision rail.
- Operations: queue first, filters second, measured data density and restrained motion.

## Tokens
The portable source is `frontend/tokens.css`, imported by the existing CSS entry.
Keep runtime variable names (`--bg`, `--accent`, etc.) because the existing theme
studio writes these variables. Default theme is dark; custom administration themes
continue to control the same semantic surfaces, navigation, text and accent.

Display: Barlow Condensed 600/700. Body: Manrope variable. Fonts are self-hosted.
Four-point spacing scale. Controls have a 4px radius; panels 8px. Use borders and
space rather than shadows. Status colors retain semantic meaning and text labels.

## Motion
GSAP timelines for campaign entrances; ScrollTrigger for section reveals and desktop
media parallax. Transforms and opacity only. Context cleanup on unmount. Reduced
motion disables spatial animation; mobile avoids parallax. Operational controls stay
immediate. Retain Motion where it supports existing interactive component lifecycles.

## Accessibility
Visible instant focus rings, 44px touch controls, labeled inputs, keyboard navigation,
focus containment and restoration in dialogs, skip navigation, responsive tables.
All data states retain their existing actions. No generated imagery on sale offers.

## Boundaries
Route paths, API calls, services, payloads, authentication, permissions, business
rules, streaming and upload behavior are preserved. No deployment or backend edits.

## Exports

CSS: `frontend/tokens.css` is the complete runtime token export.

Tailwind v4 aliases, for future utility consumers:

```css
@theme inline {
  --color-paper: var(--bg);
  --color-ink: var(--ink);
  --color-racing: var(--accent);
  --font-display: 'Barlow Condensed', sans-serif;
  --font-body: 'Manrope Variable', sans-serif;
  --spacing-md: 1.5rem;
}
```

DTCG representation of the identity:

```json
{
  "color": {
    "paper": { "$type": "color", "$value": "oklch(15% .005 260)" },
    "ink": { "$type": "color", "$value": "oklch(96% .003 260)" },
    "accent": { "$type": "color", "$value": "oklch(73% .18 42)" }
  },
  "font": {
    "display": { "$type": "fontFamily", "$value": "Barlow Condensed" },
    "body": { "$type": "fontFamily", "$value": "Manrope Variable" }
  }
}
```

Equivalent shadcn semantic mapping (reference only; no extra UI library installed):

```css
:root {
  --background: var(--color-paper); --foreground: var(--color-ink);
  --card: var(--color-panel); --card-foreground: var(--color-ink);
  --primary: var(--color-accent); --primary-foreground: var(--color-paper);
  --muted: var(--color-paper-2); --muted-foreground: var(--color-ink-2);
  --border: var(--color-rule); --input: var(--border-strong);
  --ring: var(--focus-ring); --radius: 4px;
}
```

