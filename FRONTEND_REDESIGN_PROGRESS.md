# Frontend redesign progress

Started 2026-10-14. Authorized by FRONTEND_REDESIGN.md and the user's implementation request.

## Baseline
- React 19 / Vite / TypeScript / Tailwind 4 / Zustand / React Query / Motion / Lucide.
- Production build passed (existing large-chunk warning).
- 14 test files, 117 tests passed before edits.
- Only pre-existing untracked file: FRONTEND_REDESIGN.md.
- No AGENTS.md found. Repository frontend guidance consists of markdown references,
  not SKILL.md packages. Installed design, GSAP, Sites and accessibility skills read.
- Existing theme studio must remain functional through semantic CSS variables.

## Route inventory
| Routes | Screen / behavior |
| --- | --- |
| `/`, `/dealers` | Buyer / dealer marketing, signup and login navigation |
| `/login` | Buyer, dealer and staff authentication |
| `/signup`, `/signup/:role` | Role chooser, buyer/dealer/support registration and uploads |
| `/forgot-password` | Existing reset request placeholder |
| `/terms`, `/privacy` | Existing development legal content |
| `/home` | Buyer/dealer overview; staff redirected to support |
| `/profiles` | Account details and buyer preferences |
| `/account`, `/billing` | Live subscription and simulated checkout |
| `/requests`, `/requests/new`, `/requests/:id` | Buyer requests, creation and offer comparison |
| `/orders`, `/orders/:id` | Buyer accepted deals |
| `/chatbot` | Sera streaming, tools, preferences and guided request builder |
| `/feed`, `/feed/:requestId` | Dealer demand filters and itemized quote creation/uploads |
| `/quotes`, `/quotes/:id` | Quote list/detail, revisions and decisions |
| `/deals`, `/deals/:id` | Dealer fulfillment |
| `/chat/:quoteId?`, `/chat/requests` | Private messages and negotiation inbox |
| `/support`, `/help-support`, `/tickets`, `/tickets/:ticketId` | Support console, queues and case actions |
| `/verifications`, `/support-members` | Verification and staff management |
| `/support-administration` | Workflow, prompts, models, themes, monitoring and team |
| `/unauthorized`, `*`, route error | Access, missing-page and runtime error states |

## Completed implementation
- Brand is **Deal&Drive**. Existing hero text, process copy, Sera explanation, buyer
  benefits, dealer benefits, pricing explanation, journey, dealer comparison,
  signup destinations, legal wording and FAQ answers are carried into the new UI.
- Replaced the old global stylesheet with portable tokens and six stylesheets:
  system, workspaces, conversations, authentication, operations, administration.
- Public routes use a new Campaign component, editorial process rows, three
  original automotive images, photographic story sections and native FAQ disclosures.
- Authenticated routes use a new desktop rail and context bar, responsive menu,
  new buttons, controls, data tables, request compositions and decision rails.
- Messaging and Sera use a bounded conversation workbench and mobile list/thread
  navigation; guided question panels, image/source results and composers are rebuilt.
- Rebuilt plan cards, checkout, profile, support queues, case views, evidence
  dialogs, staff drawers, React Flow canvas, prompt editor and theme studio surfaces.
- Former stock blue/cream theme is migrated in the frontend renderer; custom
  administration theme contracts remain. The old toggle was replaced with a new
  shared header switch in the follow-up below.
- Added shared dialog focus containment/restoration, instant focus rings, reduced
  motion support and semantic loading/empty states.
- GSAP: hero entrance timeline, section reveals, desktop image parallax, shared
  Reveal component, scoped useGSAP cleanup and matchMedia reduced-motion rules.
- Self-hosted Barlow Condensed and Manrope. Added gsap, @gsap/react and two font
  packages; retained Motion because existing interactive components still use it.

## Removed
- Old LandingScreen.css, DealerLandingScreen.css and darkTheme.css.
- Old CustomerSections presentation, SpotlightCard, AnimatedNumber, theme toggle
  component, and unused scroll-spy helper.
- Old dealer hero PNG, after checking that it has no remaining consumers.
- Replaced old loader, Sera mark, question panel and administration CSS in place.
- Temporary migration scripts, extracted layout files and installation cache.
- The old drivedeal-hero.png remains solely because the inventory adapter references
  it. Genuine media, uploads, API data transformations and media services are intact.

## Validation results
- Initial build passed and 117 initial tests passed.
- Final production build / TypeScript: passed; existing >500 KB chunk warning remains.
- ESLint: passed with zero warnings.
- Vitest: 15 files / 120 tests passed, including three new stock-theme migration and
  custom-theme preservation tests.
- Browser used existing development buyer, dealer and support administrator accounts
  against the configured API; no mock data or invented endpoints were introduced.
- Checked live sign-in, buyer search and URL filters, request form, order list/detail,
  genuine offer media area, profile, plan cards, checkout details, Sera greeting and
  conversation history, private messaging, mobile conversation selection and menu.
- Dealer feed keyboard filters narrowed 8 cards to 5 Audi matches; checked quote
  creation form, quote list, deals and dealer navigation.
- Checked support console, ticket queue/case, verification queue/dialog, dialog focus,
  staff list, administrator overview, workflow canvas, prompt editor, runtime controls,
  live theme preview iframe, team panel, trace list and audit/version history.
- Checked all public route families, including all three registration roles, legal
  pages, reset page and missing-page state.
- Homepage widths: 360, 390, 768, 1024, 1440 and 1920; no page overflow and primary
  action fits the first screen at tested widths. Mobile registration/content routes
  checked at 390px; workflow canvas checked from 360 to 1440px without page overflow.
- Public visual evidence: output/redesign/home-desktop.jpg and home-mobile.jpg.
- Browser console error checks returned no errors on inspected workspace screens.
- Git diff confirms backend, API clients, realtime integration, auth/store, route
  definitions, guards, environment configuration and infrastructure files unchanged.

## Verification limits
- No payment, request publication, quote submission, acceptance/decline, evidence
  decision, role update or administrator configuration publication was performed.
  Their handlers and API contracts remain in place; existing tests cover supporting
  logic, but those write operations were not exercised end to end.
- No separate end-to-end test runner is configured in the frontend package scripts.
- Existing password reset is a development placeholder; existing checkout is a
  simulated payment flow. These behaviors were preserved.
- No deployment or publication was performed.

## Follow-up: light and dark workspace themes
- Added a visible header switch for buyers, dealers, support and administrators,
  including the mobile header. Native button keyboard interaction, an accessible
  switch state and a descriptive tooltip are included.
- Both modes apply to the entire workspace and body-mounted dialogs. Light mode
  has pale page surfaces, white cards, dark text, contrasting status colors and
  readable orange links; action buttons retain the brand orange with dark text.
- The personal preference uses the existing storage key, survives reloads and
  navigation, and synchronizes between tabs. Dark remains the default for new users.
- Active-theme refreshes preserve the preference. Administration's embedded theme
  preview renders its exact draft independently of the personal workspace mode.
- This follow-up passed the production build and ESLint. No additional automated
  test suite was run for this follow-up.
- Manually inspected both switch states in buyer, dealer and support workspaces;
  buyer keyboard activation, reload persistence and request-page navigation;
  the dealer feed; support's white dialog surface and focus containment; and
  header fit at 360px and 1440px. Screenshot: output/redesign/workspace-light.jpg.

