---
title: Angular MVVM Architecture and Component Structure Guidelines
inclusion: auto
name: angular-mvvm-architecture
description: MVVM-inspired Angular architecture with View (standalone component + template), ViewModel (component-scoped injectable with signals), Service, and Type layers plus a component classification decision tree for Screens, Screen-Scoped, Basic Reusable, and Self-Contained components. Use when designing Angular application structure or deciding component architecture.
---

# MVVM Architecture and Component Structure Guidelines

## Context & Aim

**Goal**: Implement an MVVM-inspired Angular architecture with clear component segregation and maintainable separation of concerns, consistent with the React, Flutter, and MAUI clients.

**Standard**: Modern Angular only — standalone components, signals, zoneless change detection, built-in control flow (`@if`, `@for`, `@switch`, `@defer`), `inject()`, and signal-based `input()` / `output()` / `model()`. ViewModels handle business logic and state, components handle presentation, Services manage data access.

**Impact**: Clear separation improves testability, maintainability, prevents over-abstraction, and keeps the same mental model across every client platform.

## MVVM Architecture Pattern

### Core Architecture Layers
- **Views (UI)**: Standalone components — the `.ts` class plus its `.html` template and `.scss` styles
- **ViewModels (Logic)**: `@Injectable()` classes in `.vm.ts` files, provided at the component level, holding state as signals
- **Services**: Backend communication (via the BFF Adapter), platform/device APIs, and data access
- **Types**: Business Objects (BOs), enums, and generated BFF DTOs (no separate Model classes)

### Directory Structure Overview
```
src/
├── main.ts                     # bootstrapApplication(App, appConfig)
├── environments/               # environment.ts, environment.development.ts
└── app/
    ├── app.ts / app.html       # Root component (router outlet + global shell only)
    ├── app.config.ts           # ApplicationConfig: providers (router, http, error handler, services)
    ├── app.routes.ts           # Single route configuration
    ├── ui/
    │   ├── navigations/        # Guards, resolvers, route constants, shell/layout components
    │   ├── screens/            # Full-page (routed) components with ViewModels
    │   └── reusables/          # Shared UI components, directives, pipes
    ├── services/
    │   ├── bff/                # BFF Adapter + HTTP interceptors — single entry point for all BFF calls
    │   ├── generated/          # AUTO-GENERATED BFF types from /docs/json (never edit manually)
    │   ├── screens/            # Screen Services — read-only, mirrors BFF api/screens/
    │   ├── domains/            # Domain Services — mutations, mirrors BFF api/domains/
    │   └── platform/           # Platform/Device Services — no BFF involvement
    ├── store/                  # Global SignalStores (see state-management)
    ├── types/                  # Domain-specific Business Objects and Enums
    └── helpers/                # serviceResult helpers, logging, validation, utilities
public/                         # Static assets copied as-is (images, icons, lottie, fonts)
```

## Component Classification and Decision Tree

### Component Classification Decision Tree

When creating any UI element, follow this decision tree:

```
Is this a full-page (routed) view?
├─ YES → Create as SCREEN in ui/screens/
└─ NO → Is it reusable across multiple screens?
    ├─ YES → Does it need complex logic/state/API calls?
    │   ├─ YES → Create as SELF-CONTAINED REUSABLE in ui/reusables/ with ViewModel
    │   └─ NO → Create as BASIC REUSABLE in ui/reusables/ (inputs/outputs only)
    └─ NO → Is it a small repeated fragment with no own behavior?
        ├─ YES → Use an <ng-template> inside the screen's template
        └─ NO → Create as SCREEN-SCOPED COMPONENT inside the screen's folder
```

### Component Types and Structure

#### Screen Components
- **Location**: `ui/screens/{screen-name}/`
- **Structure**: `{screen-name}.ts` + `{screen-name}.html` + `{screen-name}.scss` + `{screen-name}.vm.ts` (+ specs)
- **Characteristics**: Routed page, complex state, always has a ViewModel
- **ViewModel scope**: Provided in the screen's `providers: [ScreenViewModel]` — created and destroyed with the screen

#### Screen-Scoped Components (Angular equivalent of React inline components)
- **Location**: Flat files in the same screen folder (e.g., `ui/screens/user-management-screen/user-row.ts`) — no nested sub-folders
- **Access**: Inject the screen ViewModel directly with `inject(UserManagementScreenViewModel)` — the element injector makes the screen's VM available to all its descendants, so no input/output drilling is needed
- **Rule**: Never import a screen-scoped component outside its screen; promote it to `ui/reusables/` once a second screen needs it
- **Ordering in the template**: content sections (headers, cards, rows) first; dialogs/overlays last

#### Basic Reusable Components
- **Location**: `ui/reusables/{component-name}/`
- **Structure**: `{component-name}.ts` + `.html` + `.scss` (+ spec)
- **Characteristics**: Presentational only — communicates through `input()`, `output()`, and `model()`; no ViewModel, no service injection
- **Examples**: Button, TextField, Badge, Dialog shell

#### Self-Contained Reusable Components
- **Location**: `ui/reusables/{component-name}/`
- **Structure**: `{component-name}.ts` + `.html` + `.scss` + `{component-name}.vm.ts` (+ specs)
- **Characteristics**: Complex logic, API calls, internal state; VM provided in the component's own `providers`
- **Examples**: SearchableDropdown, DataTable, FileUploader

### Component Rules (all types)
- Always standalone (the default) — never create `NgModule`s
- Always `changeDetection: ChangeDetectionStrategy.OnPush`
- Use separate `templateUrl` / `styleUrl` files; inline templates only for components under ~10 lines of markup
- Group Angular members at the top of the class: injected dependencies → inputs → outputs → queries → computed values → methods
- Mark template-only members `protected`; mark `input`, `output`, `model`, and query fields `readonly`
- Use `host: {}` in the decorator instead of `@HostBinding` / `@HostListener`
- Use `[class.x]` / `[style.x]` bindings instead of `NgClass` / `NgStyle`
- Name event handlers for the action (`saveUser()`), not the event (`onClick()`)
- Keep lifecycle hooks short — call well-named VM methods

## Layer Responsibilities

### ViewModel Responsibilities (High-Level)
- State as `signal()`; derived state as `computed()`
- Business logic and data transformation
- Calling Screen/Domain/Platform services and interpreting `ServiceResult`
- Form construction, validation, and submission logic
- Navigation (`inject(Router)`) and user feedback (toasts, dialogs)

### View Responsibilities (High-Level)
- Template structure using `@if`, `@for` (always with `track`), `@switch`, `@defer`
- Binding events to ViewModel methods
- Reading ViewModel signals in the template (`vm.users()`)
- Styling and layout (design system components → utility classes → component SCSS)
- Accessibility attributes
- Only presentation logic in the component class — no service calls, no `HttpClient`

### Service Layer Role
- **Screen Services**: Fetch screen-shaped read data from BFF `api/screens/` endpoints — **platform-specific** (BFF uses the `x-client-type: web` header to serve the web shape)
- **Domain Services**: Execute mutations via BFF `api/domains/` endpoints — **platform-agnostic** (same contract across React, Angular, Flutter, and MAUI)
- **BFF Adapter**: Single injectable wrapping `HttpClient`; functional interceptors add auth headers, `x-client-type: web`, correlation IDs, and normalize errors into `ServiceResult<T>`
- **Generated Types**: All BFF request/response types generated from the BFF OpenAPI spec with `openapi-typescript` — never hand-written
- **Platform/Device Services**: Browser APIs (camera, geolocation, storage, clipboard) with no BFF involvement — same interface contract as the other platforms
- Every service has an interface + `InjectionToken`, a real implementation, and a mock implementation; the binding is chosen in `app.config.ts`
- Services return `Promise<ServiceResult<T>>` and never throw

## Progressive Enhancement Approach

### Component Enhancement Strategy
- Start with screen-scoped components or `<ng-template>` for screen-specific UI
- Promote to basic reusable only when used across multiple screens
- Add a ViewModel only when complex logic/state/API calls are needed
- Use `@defer` for below-the-fold or heavy sections instead of splitting into more routes

### Decision Guidelines
1. **Determine reusability**: Multiple screens? → `ui/reusables/`; single screen? → screen-scoped
2. **Assess complexity**: Complex logic/state/API calls? → Add ViewModel; simple display? → inputs/outputs only
3. **Evaluate scope**: Routed page? → Screen; UI section? → Screen-scoped or reusable

## Architecture Patterns to Follow

### Separation of Concerns
- Clear separation between Views, ViewModels, and Services
- Components handle only presentation logic
- ViewModels handle business logic and state
- Services handle data access and backend communication

### Dependency Injection
- Use `inject()` — never constructor parameter injection
- Provide ViewModels at the component level (`providers: [XViewModel]`), never `providedIn: 'root'`
- Provide services in `app.config.ts` through provider functions (`provideScreenServices()`, `provideDomainServices()`) that switch between real and mock implementations
- Global state stores are `providedIn: 'root'`

### Application Bootstrap (`app.config.ts`)
- `provideZonelessChangeDetection()` (default in new projects) — do not add `zone.js`
- `provideBrowserGlobalErrorListeners()` and a custom `ErrorHandler`
- `provideRouter(routes, withComponentInputBinding(), withViewTransitions())`
- `provideHttpClient(withFetch(), withInterceptors([...]))`

### Service Contract Pattern
```typescript
// user-profile-screen.contract.ts — interface + token (one contract per file)
export interface IUserProfileScreenService {
  getUserProfile(userId: string): Promise<ServiceResult<UserBO>>;
}
export const USER_PROFILE_SCREEN_SERVICE =
  new InjectionToken<IUserProfileScreenService>('USER_PROFILE_SCREEN_SERVICE');

// user-profile-screen.service.ts — real implementation (reads only, via the BFF Adapter)
@Injectable()
export class UserProfileScreenService implements IUserProfileScreenService {
  private readonly bff = inject(BffAdapter);

  getUserProfile(userId: string): Promise<ServiceResult<UserBO>> {
    return this.bff.get<UserBO>(`/api/screens/user-profile/${userId}`);
  }
}

// services/screens/provide-screen-services.ts — real/mock switch, registered in app.config.ts
export function provideScreenServices(): Provider[] {
  return [
    {
      provide: USER_PROFILE_SCREEN_SERVICE,
      useClass: environment.useMockServices ? MockUserProfileScreenService : UserProfileScreenService,
    },
  ];
}
```

### BFF Adapter
- The only class that injects `HttpClient`; exposes `get` / `post` / `put` / `patch` / `delete` returning `Promise<ServiceResult<T>>` (via `firstValueFrom`)
- Applies a request timeout (`timeout()` operator) and retry with backoff for idempotent GETs only
- Converts `HttpErrorResponse` to `ServiceResult` with `adaptApiResponse()` / `serviceFailureResponse()` — never rethrows
- Cross-cutting headers live in functional interceptors under `services/bff/interceptors/`: `authInterceptor`, `clientHeadersInterceptor` (`x-client-type: web`, `x-client-version`), `correlationIdInterceptor` (`x-correlation-id`, `x-request-id`)

### File Organization
- One concept per file; related files co-located in the same folder
- Specs co-located next to the file they test
- No barrel `index.ts` files anywhere

## Anti-Patterns to Avoid

### Architecture Anti-Patterns
- Business logic or service calls in component classes or templates
- Creating ViewModels for simple presentational components
- Injecting `HttpClient` anywhere except the BFF Adapter
- Injecting concrete service classes instead of their `InjectionToken`
- Creating `NgModule`s, or using `zone.js`-dependent patterns (`NgZone.run`, relying on `setTimeout` to trigger change detection)

### Component Anti-Patterns
- Creating sub-folders for screen-scoped components
- Making components reusable prematurely
- Importing a screen-scoped component from another screen
- Passing VM state through long input/output chains when the screen VM can be injected
- Calling methods in templates (`{{ getTotal() }}`) — use `computed()` signals
- `@for` without `track`, or tracking by `$index` for entity lists
- Using `*ngIf` / `*ngFor` / `*ngSwitch` — use built-in control flow

### ViewModel Anti-Patterns
- Providing a screen VM in `root` (state leaks between visits)
- Screen components injecting sub-ViewModels directly (see Mediator pattern)
- ViewModels touching the DOM (`document`, `ElementRef`) — that belongs to the component or a directive
- Manual `subscribe()` without teardown — use `takeUntilDestroyed()` or prefer signals/promises

This architecture ensures maintainable code while preventing over-abstraction and keeping the same layering across all client platforms.
