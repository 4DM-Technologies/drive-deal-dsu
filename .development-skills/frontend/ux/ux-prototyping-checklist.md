---
title: UX Prototyping Checklist
inclusion: manual
---

# UX Prototyping Checklist

Use this checklist when reviewing or finalizing any visual prototype or design composition.

## Visual Foundation
- [ ] One clear focal point per screen/section, identifiable in under 2 seconds?
- [ ] No more than 3 levels of visual emphasis?
- [ ] Size differences between hierarchy levels are meaningful (1.5–2× minimum)?
- [ ] Layout follows natural reading pattern (F-pattern for text-heavy, Z-pattern for minimal)?
- [ ] Balance type (symmetrical/asymmetrical) matches brand mood?
- [ ] Whitespace used strategically for hierarchy, not just filling space?

## Color
- [ ] 60/30/10 ratio applied (dominant/secondary/accent)?
- [ ] Accent color reserved for interactive/focal elements only?
- [ ] All text meets WCAG AA contrast (4.5:1 normal, 3:1 large)?
- [ ] Color is never the sole indicator of meaning or state?
- [ ] Palette tested in grayscale?

## Typography
- [ ] Consistent type scale with defined steps?
- [ ] Body text ≥ 16px?
- [ ] Line height 1.4–1.6× for body text?
- [ ] Line length 45–75 characters on desktop?
- [ ] No more than 2 typefaces?
- [ ] Font choices match project personality?

## Interaction & States
- [ ] Interactive elements look interactive (buttons, links visually distinct)?
- [ ] All states designed: default, hover, active, focus, disabled?
- [ ] Focus indicators visible and high-contrast?
- [ ] Error messages specific, inline, with recovery action?
- [ ] Loading/progress states designed for operations > 1 second?

## Accessibility
- [ ] Keyboard navigation flow is logical?
- [ ] Touch targets ≥ 44×44px?
- [ ] Heading levels hierarchical (h1→h2→h3)?
- [ ] Form fields have visible persistent labels?
- [ ] Animations respect `prefers-reduced-motion`?
- [ ] No content flashes > 3 times/second?

## Responsiveness
- [ ] Design works on mobile viewport?
- [ ] Text reflows at 320px without horizontal scrolling?
- [ ] Content readable at 200% zoom?
- [ ] Charts/data viz work as static images?

## Dark Mode (if applicable)
- [ ] Base surface #121212, not pure black?
- [ ] Brand colors desaturated for dark backgrounds?
- [ ] Text uses opacity-based white?
- [ ] All states tested on dark surfaces?
- [ ] Images have reduced brightness or dark overlays?
