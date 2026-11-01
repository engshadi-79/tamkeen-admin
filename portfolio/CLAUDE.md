# Claude Code instructions — portfolio design handoff

This folder is a visual and interaction reference bundle for integrating the Mosalama-style Arabic portfolio into an existing application. It is not permission to replace the target application wholesale.

## Required workflow

1. Read `DESIGN-SPEC.md` and inspect `index.html`, `assets/`, and the six `ref-section-*.png` reference captures before editing the host application.
2. Inspect the host repository instructions (`CLAUDE.md`, `AGENTS.md`, package scripts), current routes, component conventions, data sources, and existing tests/build commands.
3. Implement the design inside the host app's existing framework and route structure. Preserve its authentication, APIs, data model, forms, analytics, and other working behavior. Do not replace the host's root entry point with this static reference page.
4. Use the local assets from this bundle where appropriate. Map the reference content to the host app's real data and existing services. Do not hardcode credentials or adopt the reference site's backend endpoints.
5. Recreate every listed section and interaction, including responsive states and motion behavior. Keep motion functional when WebGL is unavailable and respect `prefers-reduced-motion`.
6. Run the host project's existing build and relevant verification commands. Fix regressions before reporting completion, and state what was verified.

## Integration constraints

- Keep Arabic content right-to-left; isolate English labels, numbers, and Latin headings with appropriate `dir="ltr"` handling.
- Preserve keyboard operation, visible focus, semantic headings, useful image alternatives, and reduced-motion support.
- Avoid adding a framework, animation library, or UI kit when the host project already has an adequate equivalent. Reuse current dependencies and design conventions where they do not conflict with the visual reference.
- Treat this bundle's `index.html` and CSS as the source of visual details, not as a production page to copy over the host app. Rebuild the page in the host's component architecture.
- The remote media URLs in the reference HTML belong to the original page's public media host. Replace them with approved local assets or the host project's media service when integrating.

## Completion criteria

- The host app's landing page includes the header, animated hero, tool strip, layout/glass title, services, selected work, courses, digital products, testimonials, partners/success story, CTA, and footer.
- Desktop composition, Arabic typography, colors, spacing, section order, and interaction states are compared against the supplied screenshots and local reference page.
- Mobile and reduced-motion behavior work; there are no broken assets or runtime errors in the implemented route.
- Existing host-app flows still work and the repository's relevant build/verification commands pass.
