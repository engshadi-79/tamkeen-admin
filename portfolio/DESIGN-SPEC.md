# Portfolio design and interaction specification

Use this document with `index.html`, `assets/`, and `ref-section-1.png` through `ref-section-6.png`. The screenshots are visual checkpoints; the reference page contains component structure, copy, responsive rules, and interaction examples.

## Art direction

- Full-page Arabic-first creative portfolio with a near-black canvas (`#030303` / `#050505`), warm off-white text, and amber-to-orange-red accents (`#f2a545`, `#e1281f`).
- Use large display Arabic lettering, compact uppercase English section labels, thin dark dividers, restrained orange glows, diagonal line work, fine grain, and generous black space.
- Arabic layout is RTL. English labels, social handles, numerals, and the oversized `LAYOUT` title retain their own LTR direction.
- The page is a long editorial narrative. Preserve the section order below and avoid turning it into a generic grid dashboard.

## Page structure

| Order | Reference ID | Content and layout |
|---|---|---|
| 1 | `#top` | Floating dark navigation with brand mark, Arabic links/dropdowns, search, account, and orange project CTA. Mobile uses a keyboard-operable drawer. |
| 2 | `#hero` | Two-column hero: portrait and glowing orange disc with fine orbital paths and floating metric badges on one side; senior designer label, oversized Arabic headline, short English line, Arabic intro, social links, and actions on the other. Two diagonal ticker ribbons overlap the lower hero edge. |
| 3 | `#h-layout` | Oversized LTR `LAYOUT` display word with white `LAY`, orange gradient `OUT`, glass/rib distortion, chromatic edge separation, and a short Arabic explanation. |
| 4 | `#h-tools` | Compact dark tool belt with circular software/app marks and horizontal overflow on narrow screens. |
| 5 | `#h-services` | Arabic heading plus four prominent service rows: social media, visual identity, profile/presentation design, and 3D/visualization. Each row has a number, concise description, and icon/action. |
| 6 | `#h-works` | Selected work showcase with oversized tilted poster cards in a perspective arrangement, project caption, and links to all work / trainee work. |
| 7 | `#h-courses` | Course/workshop feature cards with cover art, short copy, price/meta, and calls to action. |
| 8 | `#h-store` | Digital product cards, product art, product name/description, price/status, and purchase/details action. |
| 9 | `#h-testi` | Dense testimonial card collection with ratings, student names, and compact quotes. |
| 10 | `#h-partners` | A featured success-story quote panel with attribution and a row of circular partner/community marks. |
| 11 | `#cta` | Centered Arabic contact invitation, orange primary action, secondary contact link, and decorative orange wave horizon. |
| 12 | `.foot` | Minimal dark footer with social/navigation links, copyright, and back-to-top control. |

## Motion behavior

- **Hero portrait and metrics:** slow orbital movement; rings and statistic chips drift at different speeds. Pointer movement adds subtle parallax/repulsion. Keep the portrait, copy, and metric badges legible and layered above the ticker ribbons.
- **Hero tickers:** two wide diagonal ribbons continuously travel in opposite directions. Repeat service terms and use orange separators. On mobile, reduce their height and rotation so they do not cover the headline or controls.
- **Headings:** reveal/settle as sections enter view. Arabic service headings extend their letter spacing/tatweel on hover/focus; highlight the active row orange and reveal its matching description/action. Restore smoothly on pointer leave/focus out.
- **LAYOUT glass effect:** render text into a canvas and refract it as vertical glass ribs. The rib distortion and RGB channel split follow the pointer locally; scroll position adds a restrained global distortion/drift. Preserve white `LAY` and amber/orange `OUT`. Give the canvas the full glyph bounds so large line-height cannot clip the letters. Keep a readable HTML fallback if WebGL is absent.
- **Selected work:** poster cards form a perspective fan/stack. Hover/focus emphasizes one card, updates the caption, and dims the rest. When idle, allow slow carousel movement; stop or settle while the user interacts.
- **Cards and buttons:** use short, controlled lift/glow/edge transitions. Avoid constant motion on every card.
- **Navigation:** show dropdowns on hover and keyboard focus; indicate the active section while scrolling. Hide/reveal the header according to scroll direction if the host layout permits.
- **Motion safety:** all motion honors `prefers-reduced-motion`; never require hover for content access. Touch devices get a stable layout and click/tap equivalents.

## Responsive behavior

- Desktop keeps the asymmetric hero composition, centered editorial content width, large display type, diagonal ribbons, and multi-card layouts.
- Tablet narrows the portrait/text columns and reduces oversized type, badge density, card spread, and ticker tilt.
- Mobile stacks hero copy and portrait without clipping; keeps CTAs touch-sized; makes navigation a drawer; lets the tool strip scroll horizontally; changes work/cards to a swipeable or single-focus layout; stacks partner and CTA content; and prevents horizontal page overflow.
- Use the existing CSS breakpoints in `assets/reference-home.css` and `assets/reference-prototype.css` as implementation evidence, then adapt them to the host app's conventions.

## Content and asset mapping

- Local portrait: `assets/mo-portrait.png` and `assets/mo-portrait-500.webp`.
- Local editorial/poster images: `assets/poster-heart.webp`, `assets/poster-brain-rot.webp`, `assets/poster-heart-resists.webp`, `assets/poster-stillness-sea.webp`.
- Local fonts: `assets/fonts/HTMoshreqPro-300.woff2` through `HTMoshreqPro-900.woff2` and the supplied Open Graph image.
- Glass effect implementation reference: `assets/glass-text.js`.
- Existing page/style reference: `index.html`, `assets/reference-home.css`, `assets/reference-prototype.css`, and `assets/reference-simple-ui.css`.
- The static reference also contains public media URLs on the original site's Supabase host. Do not copy credentials or backend behavior. Map displayed data to the destination project's existing API/store and use approved asset URLs.
