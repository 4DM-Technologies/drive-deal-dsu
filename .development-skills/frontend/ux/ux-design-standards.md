---
title: UX Design Standards
inclusion: auto
name: ux-design-standards
description: Visual hierarchy, color contrast ratios, typography scales, spacing rules, accessibility requirements, dark mode guidelines, and Nielsen's interaction heuristics. Use when designing interfaces, reviewing prototypes, or ensuring UX compliance.
---

# UX Design Standards

When designing, prototyping, or reviewing visual interfaces, always apply these standards:

## Visual Hierarchy
- Every screen/section needs one clear focal point.
- Limit to 3 levels of visual emphasis (primary, secondary, tertiary).
- Use the squint test: blur your eyes — the most important element should still be obvious.
- Align hierarchy with user goals, not content inventory.

## Color
- Follow the 60/30/10 rule: 60% dominant (backgrounds/surfaces), 30% secondary (navigation/cards/headings), 10% accent (CTAs/links/alerts).
- Never use color as the sole means of conveying information.
- All text must meet WCAG AA contrast: 4.5:1 for normal text, 3:1 for large text.
- Accent colors must meet 3:1 non-text contrast against surroundings.

## Typography
- Body text minimum 16px on screens.
- Use a consistent type scale (1.25× or 1.333× ratio).
- Maximum 2 typefaces (3 with monospace).
- Line height: 1.4–1.6× for body text.
- Line length: 45–75 characters on desktop, 35–40 on mobile.
- One emphasis method at a time (bold OR italic, not both).

## Spacing & Layout
- Space between groups ≥ 1.5–2× space within groups (Gestalt proximity).
- Whitespace is an active design tool — use it to separate, group, and elevate.
- Design mobile-first: if it works on mobile, it usually works everywhere.

## Accessibility (Non-Negotiable)
- All interactive elements must be keyboard accessible.
- Focus indicators must be visible (3:1 contrast minimum).
- Touch targets: minimum 44×44px (or 24×24 with adequate spacing).
- Respect `prefers-reduced-motion` for animations.
- Semantic heading order (h1→h2→h3, no skipping).
- Images need appropriate alt text. Form fields need visible persistent labels.

## Dark Mode
- If supporting dark mode: use #121212 base (not pure black), elevation via lighter surfaces, desaturated brand colors, opacity-based text (87%/60%/38% white).
- Never pure white text on pure black background.
- Test all states and contrast at every surface level.

## Interaction Design (Nielsen's Heuristics)
- Provide immediate feedback for every user action.
- Use the user's language, not internal jargon.
- Always provide undo/exit/back. Confirmation only for irreversible actions.
- Maintain consistency: same action = same look and behavior everywhere.
- Prevent errors with constraints, defaults, and inline validation.
- Make options visible (recognition over recall).
- Error messages: plain language, specific, with recovery action.
