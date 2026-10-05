---
title: React Development Checklist
inclusion: manual
---

# React Development Checklist

## Context & Aim

**Goal**: Comprehensive checklist covering all development guidelines to ensure consistent, maintainable, and high-quality React applications.

**Standard**: Complete verification of architecture, coding standards, accessibility, security, and best practices.

**Impact**: Systematic quality assurance that prevents common issues and ensures adherence to all established guidelines.

## Pre-Development Setup

### Project Structure
- [ ] Directory structure follows MVVM pattern (`ui/`, `services/`, `types/`, `helpers/`, `assets/`)
- [ ] Folder names use camelCase (except React Components/Pages which use PascalCase)
- [ ] `services/` is organized as: `bff/`, `generated/`, `screens/`, `domains/`, `platform/`
- [ ] Screen service folders named `{screenName}ScreenService/` (e.g., `userProfileScreenService/`)
- [ ] Domain service folders named `{entity}DomainService/` (e.g., `userDomainService/`)
- [ ] Platform/device service folders end with `Service` (e.g., `cameraService/`)
- [ ] No `index.ts` barrel export files anywhere
- [ ] Asset files follow naming convention (`img-{name}.svg`, `video-{name}.mp4`, etc.)

### TypeScript Configuration
- [ ] Strict mode enabled in TypeScript configuration
- [ ] No `any` types allowed
- [ ] Explicit return types for all functions
- [ ] All interfaces and types properly defined

## Architecture and Component Development

### Component Classification
- [ ] Full-page components created as Screens in `ui/screens/`
- [ ] Screen-specific UI created as inline components (inside main component function)
- [ ] Reusable components only created when used across multiple screens
- [ ] Complex reusables have ViewModels, simple ones are stateless
- [ ] Progressive enhancement approach followed (inline → basic reusable → self-contained)

### MVVM Architecture
- [ ] Clear separation: Views (UI), ViewModels (Logic), Services (Data), Types (Models)
- [ ] Views handle only presentation logic
- [ ] ViewModels handle business logic, state management, and data transformation
- [ ] Services handle backend communication and data access
- [ ] No business logic in View components

### File Organization
- [ ] Screen files: `ScreenName.tsx` + `ScreenName.vm.ts`
- [ ] Component files use PascalCase with `.tsx` extension
- [ ] ViewModel files use PascalCase with `.vm.ts` extension
- [ ] Direct file imports with extensions (no barrel exports)
- [ ] Inline components defined INSIDE main component function

## Naming and Import Conventions

### Naming Standards
- [ ] Components: PascalCase (`UserProfile`, `SearchModal`)
- [ ] Functions/Variables: camelCase (`getUserData`, `isLoading`)
- [ ] Constants: SCREAMING_SNAKE_CASE (`API_BASE_URL`)
- [ ] Custom Hooks: camelCase starting with "use" (`useAuth`)
- [ ] Business Objects: PascalCase + "BO" suffix (`UserBO`)
- [ ] DTOs: PascalCase + "DTO" suffix (`CreateUserRequestDTO`)
- [ ] Enums: PascalCase + "ENUM" suffix (`UserStatusENUM`)
- [ ] Interfaces: PascalCase with "I" prefix (`IUserService`)

### Import Rules
- [ ] Direct file imports with extensions (`.tsx`, `.ts`)
- [ ] Never use `index.ts` barrel exports
- [ ] Use `@/` alias for src directory imports
- [ ] Relative imports only for same-directory files (ViewModels)
- [ ] Import names match exported names exactly

### Import Organization
- [ ] React core imports first
- [ ] External package imports second
- [ ] Internal absolute imports with `@/` alias third
- [ ] Relative imports last

### Import Paths
- [ ] Screen components: `@/ui/screens/[ScreenName]/[ScreenName].tsx`
- [ ] Reusable components: `@/ui/reusables/[ComponentName]/[ComponentName].tsx`
- [ ] BFF Adapter: `@/services/bff/BffAdapter.ts`
- [ ] Generated BFF types: `@/services/generated/bff.types.gen.ts`
- [ ] Screen Services: `@/services/screens/[screenName]ScreenService/[ScreenName]ScreenService.ts`
- [ ] Domain Services: `@/services/domains/[entity]DomainService/[Entity]DomainService.ts`
- [ ] Platform Services: `@/services/platform/[name]Service/[Name]Service.ts`
- [ ] Business Objects: `@/types/[module]/[TypeName].ts`
- [ ] ServiceResult helpers: `@/helpers/serviceResult/serviceResultHelpers.ts`
- [ ] Utilities: `@/helpers/utilities/[utilityName].ts`
- [ ] Assets: `@/assets/images/[asset-name].[ext]`

## Type Management

### Type Organization
- [ ] Business Objects in `@/types/[module]/` with "BO" suffix
- [ ] BFF DTOs (Screen/Domain): imported from `@/services/generated/bff.types.gen.ts` — never hand-written
- [ ] Platform/Device DTOs: defined inline in the service file
- [ ] Enums in `@/types/[module]/` with "ENUM" suffix
- [ ] One file per type (or grouped when highly interrelated)
- [ ] No transformation functions between BO and DTO

### Type Usage Priority
- [ ] Use DTO directly if structure fits UI needs
- [ ] Use BO when domain logic is required
- [ ] Create UI-specific types only when necessary
- [ ] Service contracts co-located with service implementation

## Service Layer

### Service Classification
- [ ] Is this fetching data for a screen? → Screen Service in `services/screens/`
- [ ] Is this mutating/creating/updating/deleting data? → Domain Service in `services/domains/`
- [ ] Is this OS-level or hardware-level with no BFF? → Platform/Device Service in `services/platform/`
- [ ] Screen Services only use `bffAdapter.get()` — no mutations
- [ ] Domain Services only use `bffAdapter.post/put/delete()` — no reads for display
- [ ] Platform/Device Services never call the BFF Adapter

### BFF Adapter
- [ ] All Screen and Domain services use `bffAdapter` from `@/services/bff/BffAdapter.ts`
- [ ] No raw `axios.create()` instances in Screen or Domain services
- [ ] BFF Adapter handles auth headers, correlation ID, and error normalization

### Type Generation
- [ ] `npm run generate:bff-types` run after any BFF schema change
- [ ] No hand-written DTOs for BFF screen or domain calls
- [ ] Screen and Domain service types imported from `@/services/generated/bff.types.gen.ts`
- [ ] `bff.types.gen.ts` committed and up-to-date in source control
- [ ] Platform/Device services define their own types inline (no generated types)

### Service Structure
- [ ] Each service has an interface (`I{Name}ScreenService.ts` / `I{Name}DomainService.ts`)
- [ ] Each service has a real implementation and a mock implementation
- [ ] Mock services use generated types — not invented shapes
- [ ] Services exported as singletons — imported directly in ViewModels (no registration in App.tsx)
- [ ] ViewModel tests mock services using `vi.mock()` at the module level — never mock `bffAdapter` directly

### ServiceResult Pattern
- [ ] All services return `ServiceResult<T>` format
- [ ] Never throw exceptions from services
- [ ] Use `adaptApiResponse()` for HTTP responses (via BffAdapter)
- [ ] Use `serviceFailureResponse()` in catch blocks
- [ ] Status codes use `ServiceResultStatusENUM`
- [ ] ViewModels check `result.statusCode` first, then `result.data`

## Navigation and Routing

### Router Setup
- [ ] All routes registered in a single `Router.tsx` — never in individual screens
- [ ] Protected routes wrapped with `AuthGuard` at the route level (not inside screens)
- [ ] Auth initialisation happens in `Router.tsx`, not in individual screens
- [ ] Default redirect (`/` and `*`) handles both authenticated and unauthenticated states
- [ ] `Logger.error()` used in Router catch blocks — not `console.error`

### ViewModel Navigation
- [ ] Programmatic navigation uses `useNavigate()` from React Router — called in ViewModel
- [ ] Navigation is a ViewModel concern — View components do not call `navigate()` directly

## Form Handling

- [ ] Form fields use controlled `useState` per field in the ViewModel
- [ ] Validation logic lives in the ViewModel — not in the View
- [ ] Field errors stored in `Record<string, string>` state, displayed via `role="alert"` spans
- [ ] View submits via `onSubmit` calling `e.preventDefault()` then the ViewModel handler
- [ ] `isLoading` state prevents double-submission
- [ ] `finally` block resets `isLoading` regardless of outcome

## State Management

### State Classification
- [ ] Screen-specific state uses `useState` in ViewModel
- [ ] Global reactive state uses Redux Toolkit
- [ ] Global non-reactive state uses Redux with lazy fetching
- [ ] Complex features use Mediator + sub-ViewModel pattern

### ViewModel Size Management
- [ ] ViewModels under 500 lines (use Mediator pattern if larger)
- [ ] Mediator ViewModel holds shared state, sub-ViewModels access through parameters
- [ ] Sub-ViewModels communicate through Mediator only
- [ ] Screen/View consumes only Mediator ViewModel, not sub-ViewModels directly

### ViewModel Implementation
- [ ] All business logic in `.vm.ts` files
- [ ] State management using React hooks
- [ ] Try-catch blocks in all important functions
- [ ] Check `result.statusCode` first for service responses
- [ ] Access `result.data` only after confirming success
- [ ] Display `result.message` for user feedback
- [ ] Never re-throw exceptions to Error Boundaries

## Exception Handling

### Error Boundary Setup
- [ ] Error Boundaries on all pages/screens
- [ ] Error Boundaries on complex reusable components
- [ ] Global fallback Error Boundary for unhandled errors

### Service Exception Handling
- [ ] Services return ServiceResult, never throw
- [ ] Try-catch blocks wrap API calls
- [ ] `serviceFailureResponse()` used in catch blocks
- [ ] Structured error handling with status codes

### Helper Function Handling
- [ ] Return meaningful values when possible (boolean, validation objects)
- [ ] Throw only when no meaningful return value exists
- [ ] Context logging when handling exceptions internally
- [ ] Validation helpers return boolean or validation results

### Centralized Logging
- [ ] Single Logger class wraps console methods (info, warn, error, debug)
- [ ] External logger integration ready (Sentry, LogRocket)
- [ ] All service errors logged with context
- [ ] Logger handles external logger failures gracefully

## Security Implementation

### Input Security
- [ ] All user inputs validated and sanitized before processing
- [ ] File uploads validated (type, size limits, content validation)
- [ ] URL parameters sanitized before use
- [ ] Never trust user input or external API data
- [ ] DOMPurify used before `dangerouslySetInnerHTML`
- [ ] Never use `eval()` or `innerHTML` with user data

### Authentication & Storage
- [ ] Tokens encrypted using react-secure-storage for localStorage/sessionStorage/IndexedDB
- [ ] Automatic logout on token expiry implemented
- [ ] Sensitive data cleared after use
- [ ] No passwords or API keys stored client-side
- [ ] SessionStorage used for temporary sensitive data

### API Security
- [ ] HTTPS used for all requests
- [ ] Required security headers added to API requests:
  - [ ] `Authorization: Bearer <token>` - Authentication token
  - [ ] `x-request-id: <uuid>` - Request tracing and correlation
  - [ ] `x-api-key: <key>` - API authentication (when applicable)
  - [ ] `x-client-version: <version>` - Client version tracking
  - [ ] `x-correlation-id: <uuid>` - Distributed tracing
- [ ] API responses validated before use
- [ ] Errors handled without exposing sensitive details
- [ ] Request timeout and retry logic implemented

### Environment Security
- [ ] Environment variables used for all configuration
- [ ] No secrets committed to git (.env files in .gitignore)
- [ ] Required environment variables validated at app startup
- [ ] Different configurations per environment (dev/staging/prod)

## Accessibility Compliance

### Semantic HTML
- [ ] `<button>` for actions, `<a>` for navigation
- [ ] Form inputs have associated `<label>` elements (use `useId()` for unique IDs)
- [ ] Logical heading hierarchy (h1 → h2 → h3, no skipping levels)
- [ ] Landmark elements used (`<main>`, `<nav>`, `<header>`, `<footer>`, `<section>`)

### Keyboard Navigation
- [ ] All interactive elements work with Tab, Enter, Space, Escape
- [ ] Visible focus indicators (3:1 contrast ratio minimum)
- [ ] Logical tab order
- [ ] Focus trapped in modals and returns to trigger on close

### Color & Contrast
- [ ] Text contrast ≥ 4.5:1 (normal), ≥ 3:1 (large 18pt+)
- [ ] Information not conveyed by color alone
- [ ] Error states have text/icons, not just color

### Images & Forms
- [ ] Meaningful images have descriptive `alt` text
- [ ] Decorative images use `alt=""`
- [ ] Required fields clearly indicated
- [ ] Error messages specific and actionable
- [ ] Related inputs grouped with `<fieldset>` and `<legend>`

### Dynamic Content & ARIA
- [ ] Loading states announced with `aria-live="polite"`
- [ ] Error messages use `role="alert"` or `aria-live="assertive"`
- [ ] Content changes announced to screen readers
- [ ] `useId()` hook for form field associations
- [ ] Keyboard event handlers in custom components
- [ ] Focus management in useEffect hooks
- [ ] Skip links provided for main content

### Accessibility Testing
- [ ] Tab through entire component with keyboard only
- [ ] Test with screen reader (VoiceOver/NVDA)
- [ ] Automated tests with jest-axe pass
- [ ] Color contrast verified with tools

## Code Quality

### Linting & Formatting
- [ ] ESLint passes with no errors
- [ ] Prettier formats all files
- [ ] TypeScript compilation succeeds
- [ ] No console.log statements in production code
- [ ] Consistent import ordering (auto-sorted by Prettier)

### Code Standards
- [ ] 2 spaces for indentation
- [ ] Single quotes for strings
- [ ] Trailing commas where valid
- [ ] Semicolons required
- [ ] Line length: 100 characters
- [ ] Explicit return types for functions

This checklist covers all established guidelines. Anti-patterns for each area are documented in the corresponding steering file.