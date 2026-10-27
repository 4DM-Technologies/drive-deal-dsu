---
title: Angular Development Checklist
inclusion: manual
---

# Angular Development Checklist

## Context & Aim

**Goal**: Comprehensive checklist covering all Angular development guidelines to ensure consistent, maintainable, and high-quality applications.

**Standard**: Complete verification of architecture, coding standards, state, forms, routing, security, accessibility, performance, and testing.

**Impact**: Systematic quality assurance that prevents common issues and ensures adherence to all established guidelines.

## Pre-Development Setup

### Project Setup
- [ ] Latest stable Angular version (verify with Context7 / `ng version`); Node.js Active LTS pinned in `.nvmrc`
- [ ] Project created with the Angular CLI (`ng new --style=scss --ssr=false --zoneless`), pnpm as package manager
- [ ] `zone.js` not installed; `provideZonelessChangeDetection()` in `app.config.ts`
- [ ] CLI schematics configured for OnPush, SCSS, and naming conventions (see naming-and-import-conventions)
- [ ] `@/` and `@env/` path aliases configured in `tsconfig.json`

### Project Structure
- [ ] Directory structure follows MVVM pattern (`ui/`, `services/`, `store/`, `types/`, `helpers/`) under `src/app/`
- [ ] All folder and file names are kebab-case
- [ ] `services/` is organized as: `bff/`, `generated/`, `screens/`, `domains/`, `platform/`
- [ ] Screen service folders named `{name}-screen-service/`, domain service folders `{entity}-domain-service/`, platform folders `{name}-service/`
- [ ] No `index.ts` barrel export files anywhere
- [ ] No `NgModule`s
- [ ] Static assets in `public/` and follow naming convention (`img-{name}.svg`, `video-{name}.mp4`, etc.)

### TypeScript Configuration
- [ ] `strict: true` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`
- [ ] Angular compiler options: `strictTemplates`, `strictInjectionParameters`, `strictInputAccessModifiers`
- [ ] No `any` types
- [ ] Explicit return types for all functions and public methods

## Architecture and Component Development

### Component Classification
- [ ] Routed pages created as Screens in `ui/screens/` with a ViewModel
- [ ] Screen-specific UI created as screen-scoped components (flat in the screen folder) or `<ng-template>`
- [ ] Reusable components only created when used across multiple screens
- [ ] Complex reusables have a ViewModel; simple ones use inputs/outputs only
- [ ] Progressive enhancement followed (screen-scoped → basic reusable → self-contained)

### Component Implementation
- [ ] Standalone components with `ChangeDetectionStrategy.OnPush`
- [ ] `inject()` used — no constructor injection
- [ ] `input()` / `input.required()` / `output()` / `model()` — no `@Input` / `@Output` decorators
- [ ] `viewChild()` / `contentChild()` signal queries — no `@ViewChild` decorators
- [ ] Template-only members `protected`; Angular-initialized members `readonly`
- [ ] `host: {}` instead of `@HostBinding` / `@HostListener`
- [ ] Built-in control flow (`@if`, `@for`, `@switch`) — no `*ngIf` / `*ngFor`
- [ ] Every `@for` has `track` by a stable id, with an `@empty` block where relevant
- [ ] `[class.x]` / `[style.x]` bindings — no `NgClass` / `NgStyle`
- [ ] No function calls in templates — derived values are `computed()` signals

### MVVM Architecture
- [ ] Views handle only presentation logic
- [ ] ViewModels (`.vm.ts`) handle business logic, state, and service calls
- [ ] ViewModels provided in the component's `providers`, never `providedIn: 'root'`
- [ ] Services handle backend communication and data access
- [ ] No `HttpClient` outside the BFF Adapter

## Naming and Import Conventions

### Naming Standards
- [ ] Files kebab-case, matching the main class (`user-profile-screen.ts` → `UserProfileScreen`)
- [ ] ViewModels: `{name}.vm.ts` → `{Name}ViewModel`
- [ ] Services: `{name}.service.ts`, contracts `{name}.contract.ts`, mocks `{name}.service.mock.ts`
- [ ] Guards / interceptors / resolvers: functional, `{name}.guard.ts` → `authGuard`
- [ ] Stores: `{name}.store.ts` → `{Name}Store`
- [ ] Business Objects: `{name}.bo.ts` → `{Name}BO`; Enums: `{name}.enum.ts` → `{Name}ENUM`
- [ ] Interfaces: `I` prefix (`IUserDomainService`); tokens SCREAMING_SNAKE_CASE
- [ ] Selectors prefixed (`app-...`, `[appX]`); outputs without `on` prefix
- [ ] Signals without `$`; observables with `$`

### Import Rules
- [ ] Direct file imports without extensions
- [ ] Never use `index.ts` barrel exports
- [ ] `@/` alias for everything outside the current folder; `./` only for same-folder files
- [ ] Services injected via their `InjectionToken`, never the concrete class
- [ ] Import order: Angular → external → `@/` / `@env/` → relative

## Type Management

### Type Organization
- [ ] Business Objects in `@/types/[module]/` with "BO" suffix
- [ ] BFF DTOs imported from `@/services/generated/bff.types.gen` — never hand-written
- [ ] Platform/Device DTOs defined in the service contract file
- [ ] Enums in `@/types/[module]/` with "ENUM" suffix
- [ ] No transformation functions between BO and DTO unless domain logic requires it

### Type Usage Priority
- [ ] Use DTO directly if structure fits UI needs
- [ ] Use BO when domain logic is required
- [ ] Create UI-specific types only when necessary

## Service Layer

### Service Classification
- [ ] Fetching data for a screen? → Screen Service in `services/screens/`
- [ ] Creating/updating/deleting data? → Domain Service in `services/domains/`
- [ ] Browser/OS/device API with no BFF? → Platform/Device Service in `services/platform/`
- [ ] Screen Services only use `bff.get()`; Domain Services only `post/put/patch/delete()`
- [ ] Platform/Device Services never use the BFF Adapter

### BFF Adapter
- [ ] Single `BffAdapter` is the only consumer of `HttpClient`
- [ ] `provideHttpClient(withFetch(), withInterceptors([...]))` registered once in `app.config.ts`
- [ ] Functional interceptors add auth, `x-client-type: web`, `x-client-version`, `x-correlation-id`, `x-request-id`
- [ ] Request timeout applied; retries only for idempotent GETs

### Type Generation
- [ ] `pnpm generate:bff-types` (`openapi-typescript`) run after any BFF schema change
- [ ] `bff.types.gen.ts` committed and up-to-date

### Service Structure
- [ ] Each service has a contract file (interface + `InjectionToken`), a real implementation, and a mock implementation
- [ ] Mock services use generated types — not invented shapes
- [ ] Real/mock binding selected in `provideScreenServices()` / `provideDomainServices()` from `environment.useMockServices`

### ServiceResult Pattern
- [ ] All services return `Promise<ServiceResult<T>>`
- [ ] Services never throw
- [ ] `adaptApiResponse()` for HTTP responses; `serviceFailureResponse()` in catch paths
- [ ] Status codes use `ServiceResultStatusENUM`
- [ ] ViewModels check `result.statusCode` first, then `result.data`

## Navigation and Routing

### Router Setup
- [ ] All routes in a single `app.routes.ts`
- [ ] Screens lazy-loaded with `loadComponent: () => import(...).then((m) => m.XScreen)`
- [ ] Protected routes use functional guards (`canActivate: [authGuard]`) at the route level, not inside screens
- [ ] Route params bound to screen inputs with `withComponentInputBinding()`
- [ ] Default redirect (`''` and `'**'`) handles authenticated and unauthenticated states
- [ ] Page titles set with the route `title` property

### ViewModel Navigation
- [ ] Programmatic navigation via `inject(Router)` inside the ViewModel
- [ ] Templates use `routerLink` for plain links; components never call `router.navigate()` directly

## Form Handling

- [ ] Typed Reactive Forms (`NonNullableFormBuilder`) built in the ViewModel — no template-driven `ngModel` forms for business data
- [ ] Signal Forms used only if the project's Angular version marks them stable
- [ ] Validation logic (validators, cross-field rules) lives in the ViewModel or `helpers/validation/`
- [ ] Field errors shown on touch/submit with `role="alert"` and linked via `aria-describedby`
- [ ] Submit via `(ngSubmit)` calling a ViewModel method
- [ ] `isSubmitting` signal disables the submit button to prevent double submission
- [ ] `finally` block resets `isSubmitting` regardless of outcome

## State Management

### State Classification
- [ ] Screen-specific state as signals in the ViewModel
- [ ] Global state in NgRx SignalStores (`providedIn: 'root'`) under `store/`
- [ ] Non-reactive global reads use `untracked()` or method-level reads
- [ ] Complex features use the Mediator + shared state + sub-ViewModel pattern

### ViewModel Implementation
- [ ] ViewModels under 500 lines (Mediator pattern if larger)
- [ ] Writable signals private; exposed with `.asReadonly()`
- [ ] Derived values with `computed()`; `effect()` only for external side effects
- [ ] Try-catch-finally in all async methods
- [ ] `result.data` accessed only after confirming success; `result.message` shown for feedback
- [ ] Every manual `subscribe()` uses `takeUntilDestroyed()`

## Exception Handling

### Global Error Handling
- [ ] Custom `ErrorHandler` registered in `app.config.ts` that logs through `Logger`
- [ ] `provideBrowserGlobalErrorListeners()` registered
- [ ] Error / empty / loading states rendered for every screen
- [ ] `@defer` blocks for heavy content include `@placeholder`, `@loading`, and `@error` where relevant

### Service Exception Handling
- [ ] Services return `ServiceResult`, never throw
- [ ] BFF Adapter catches `HttpErrorResponse`, timeouts, and network errors
- [ ] 401 responses trigger token refresh or logout in one place (interceptor)

### Centralized Logging
- [ ] Single injectable `Logger` (info, warn, error, debug) — no direct `console.*`
- [ ] External logger integration ready (Sentry, Datadog RUM)
- [ ] All service errors logged with context and correlation ID
- [ ] Logger handles external logger failures gracefully

## Security Implementation

### Input & Output Security
- [ ] Rely on Angular's built-in template sanitization — interpolation and property bindings only
- [ ] Never use `bypassSecurityTrust*` with user or API-supplied data
- [ ] No direct DOM manipulation (`nativeElement.innerHTML`, `document.write`); use `Renderer2` only when unavoidable
- [ ] Never build templates dynamically or use `eval()` / `new Function()`
- [ ] URL parameters and query params validated before use
- [ ] File uploads validated (type, size) before sending

### Authentication & Storage
- [ ] Prefer `httpOnly` `Secure` `SameSite` cookies issued by the BFF; no tokens in `localStorage`
- [ ] If tokens must live client-side, keep them in memory only
- [ ] Automatic logout on token expiry
- [ ] No passwords, secrets, or API keys in the bundle or `environment.ts`
- [ ] `withXsrfConfiguration()` enabled when using cookie auth

### Browser Security
- [ ] Strict Content Security Policy (CSP) with nonce (`ngCspNonce` / `autoCsp`) — no `unsafe-inline` scripts
- [ ] Trusted Types enabled where supported
- [ ] HTTPS for all requests
- [ ] `pnpm audit` passes; dependencies kept current with `ng update`

### Environment Security
- [ ] Environment configuration in `src/environments/` via file replacements; no secrets committed
- [ ] Required runtime configuration validated at app startup (`provideAppInitializer`)
- [ ] Different configurations per environment (dev / staging / prod)

## Accessibility Compliance

### Semantic HTML
- [ ] `<button>` for actions, `<a routerLink>` for navigation
- [ ] Form inputs have associated `<label for>` elements
- [ ] Logical heading hierarchy (h1 → h2 → h3, no skipping levels)
- [ ] Landmark elements (`<main>`, `<nav>`, `<header>`, `<footer>`)

### Keyboard Navigation
- [ ] All interactive elements work with Tab, Enter, Space, Escape
- [ ] Visible focus indicators (3:1 contrast minimum)
- [ ] Focus trapped in dialogs and returned to the trigger on close (Angular CDK `cdkTrapFocus` / `Dialog`)
- [ ] Focus moved to the page heading after route navigation

### Color & Contrast
- [ ] Text contrast ≥ 4.5:1 (normal), ≥ 3:1 (large)
- [ ] Information not conveyed by color alone

### Dynamic Content & ARIA
- [ ] Loading states announced (`aria-live="polite"` or CDK `LiveAnnouncer`)
- [ ] Error messages use `role="alert"`
- [ ] Angular Aria / CDK primitives used for complex widgets (menus, listboxes, tabs) instead of hand-rolled ARIA
- [ ] Meaningful images have `alt`; decorative images `alt=""`

### Accessibility Testing
- [ ] `@angular-eslint/template/accessibility` rules pass
- [ ] Automated axe tests pass (unit and E2E)
- [ ] Manual keyboard-only and screen reader (NVDA/VoiceOver) check

## Performance

- [ ] All screens lazy-loaded; `@defer` for heavy below-the-fold content
- [ ] `NgOptimizedImage` (`ngSrc`) for images with width/height set
- [ ] Bundle budgets configured in `angular.json` and passing
- [ ] No unnecessary third-party libraries (check bundle with `source-map-explorer`)
- [ ] Large lists virtualized (CDK `ScrollingModule`) or paginated

## Testing

- [ ] Spec file co-located with every component, ViewModel, service, store, guard, and interceptor
- [ ] Success and failure paths tested for every public ViewModel and service method
- [ ] Coverage ≥ 80% overall, ≥ 90% for ViewModels and stores
- [ ] Playwright E2E for critical journeys

## Code Quality

### Linting & Formatting
- [ ] `angular-eslint` passes with no errors
- [ ] Prettier formats all `.ts`, `.html`, and `.scss` files
- [ ] `ng build` succeeds with `strictTemplates`
- [ ] No `console.log` in production code
- [ ] Consistent import ordering

### Code Standards
- [ ] 2 spaces for indentation
- [ ] Single quotes for strings
- [ ] Trailing commas where valid
- [ ] Semicolons required
- [ ] Line length: 100 characters
- [ ] Explicit return types for functions
