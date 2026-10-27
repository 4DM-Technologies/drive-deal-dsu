---
title: Angular Naming and Import Conventions Guidelines
inclusion: auto
name: angular-naming-imports
description: Naming patterns for Angular folders, files, classes, selectors, signals, and types plus import conventions with path aliases and CLI schematic settings. Use when setting up Angular project structure, generating files, organizing code, or establishing import standards.
---

# Naming and Import Conventions Guidelines

## Context & Aim

**Goal**: Establish consistent naming and import standards across Angular applications that follow the official Angular style guide while keeping the organization-wide type conventions (`BO`, `DTO`, `ENUM`, `I` prefix) shared with the other clients.

**Standard**: kebab-case files whose name matches the main identifier, dot role suffixes for non-component artifacts, PascalCase classes, `@/` path alias, no barrel exports.

**Impact**: Predictable names reduce cognitive load, keep Angular CLI output consistent with hand-written files, and make cross-platform code reviews easier.

## Naming Conventions

### Folder Naming
- **All folders**: kebab-case (e.g., `user-management-screen/`, `searchable-dropdown/`)
- **Screen folders**: kebab-case ending in `-screen` (e.g., `user-profile-screen/`)
- **Screen Service folders**: entity/screen name + `-screen-service` (e.g., `user-profile-screen-service/`)
- **Domain Service folders**: entity name + `-domain-service` (e.g., `user-domain-service/`)
- **Platform/Device Service folders**: name + `-service` (e.g., `camera-service/`, `auth-service/`)
- **Type module folders**: kebab-case domain name (e.g., `types/user/`, `types/order/`)
- **Asset folders** (under `public/`): kebab-case (e.g., `user-avatars/`)

### File Naming
Files use kebab-case and the base name matches the main class. Components, directives, and pipes follow the Angular CLI default (no type suffix). Other artifacts use a dot role suffix.

| Artifact | File | Class / Export |
|----------|------|----------------|
| Screen component | `user-profile-screen.ts` / `.html` / `.scss` | `UserProfileScreen` |
| Reusable component | `searchable-dropdown.ts` / `.html` / `.scss` | `SearchableDropdown` |
| ViewModel | `user-profile-screen.vm.ts` | `UserProfileScreenViewModel` |
| Directive | `autofocus.ts` | `Autofocus` (selector `[appAutofocus]`) |
| Pipe | `currency-format.pipe.ts` | `CurrencyFormatPipe` (name `currencyFormat`) |
| Service contract | `user-profile-screen.contract.ts` | `IUserProfileScreenService` + `USER_PROFILE_SCREEN_SERVICE` |
| Service implementation | `user-profile-screen.service.ts` | `UserProfileScreenService` |
| Mock service | `user-profile-screen.service.mock.ts` | `MockUserProfileScreenService` |
| BFF Adapter | `bff-adapter.service.ts` | `BffAdapter` |
| Interceptor | `auth.interceptor.ts` | `authInterceptor` (`HttpInterceptorFn`) |
| Guard | `auth.guard.ts` | `authGuard` (`CanActivateFn`) |
| Resolver | `user.resolver.ts` | `userResolver` (`ResolveFn`) |
| Global store | `admin-profile.store.ts` | `AdminProfileStore` |
| Business Object | `user.bo.ts` | `UserBO` |
| Enum | `user-status.enum.ts` | `UserStatusENUM` |
| UI type | `user.ui.ts` | `UserUI` |
| Generated BFF types | `bff.types.gen.ts` | never rename or edit manually |
| Utility | `date-format.ts` (descriptive, never `utils.ts`) | `formatDate()` |
| Unit test | `<base-name>.spec.ts` (e.g., `user-profile-screen.vm.spec.ts`) | — |
| E2E test | `e2e/<feature>.spec.ts` | — |

- **Assets**: Prefixed with type + hyphen + name
  - Images / icons: `img-{name}.{ext}` (e.g., `img-user-avatar.svg`, `img-search.svg`)
  - Videos: `video-{name}.{ext}`
  - Lottie: `lottie-{name}.json`
  - Audio: `audio-{name}.{ext}`
- Avoid generic file names: `helpers.ts`, `utils.ts`, `common.ts`, `shared.ts`

### CLI Schematic Settings (`angular.json`)
Configure the CLI so generated files match these conventions:
```json
"schematics": {
  "@schematics/angular:component": { "style": "scss", "changeDetection": "OnPush", "skipTests": false },
  "@schematics/angular:service": { "type": "service" },
  "@schematics/angular:pipe": { "typeSeparator": "." },
  "@schematics/angular:guard": { "typeSeparator": "." },
  "@schematics/angular:interceptor": { "typeSeparator": "." },
  "@schematics/angular:resolver": { "typeSeparator": "." }
}
```

### Code Element Naming
- **Classes**: PascalCase (`UserProfileScreen`, `BffAdapter`)
- **Functions/Methods**: camelCase, named for the action (`loadUsers`, `saveProfile` — not `handleClick`)
- **Variables**: camelCase (`isLoading`, `userList`)
- **Signals**: camelCase noun without a `$` suffix (`users`, `isLoading`, `selectedUser`); computed signals describe the derived value (`activeUserCount`, `canSubmit`)
- **Observables** (only where RxJS is used): camelCase with `$` suffix (`searchTerm$`)
- **Constants**: SCREAMING_SNAKE_CASE (`API_TIMEOUT_MS`, `MAX_RETRY_COUNT`)
- **Injection tokens**: SCREAMING_SNAKE_CASE (`USER_PROFILE_SCREEN_SERVICE`, `APP_CONFIG`)
- **Component selectors**: kebab-case with the app prefix (`app-user-profile-screen`)
- **Directive selectors**: camelCase attribute with the app prefix (`[appAutofocus]`)
- **Inputs/Outputs**: camelCase; outputs named for the event without `on` prefix (`userSelected`, not `onUserSelected`)
- **Route paths**: kebab-case (`/user-profile/:userId`)

### Type Naming
- **Business Objects**: PascalCase + "BO" suffix (e.g., `UserBO`, `ProductBO`)
- **Data Transfer Objects**: PascalCase + "DTO" suffix when defined outside generated types (e.g., platform service DTOs)
- **Enums**: PascalCase + "ENUM" suffix (e.g., `UserStatusENUM`)
- **Interfaces**: PascalCase with "I" prefix (e.g., `IUserDomainService`)
- **UI Types**: PascalCase + "UI" suffix when extending BOs (e.g., `UserUI`)
- **Generated BFF types**: alias at the point of use (`type UserProfileDTO = components['schemas']['UserProfile']`)

## Import Conventions

### Core Import Rules
- **Direct File Imports**: Always import directly from the file — never create or use `index.ts` barrel exports
- **No File Extensions**: Omit `.ts` in imports (required by the Angular build)
- **Path Alias**: Use `@/` mapped to `src/app/` for all imports outside the current folder
- **Relative Imports**: Use `./` only for files in the same folder (ViewModel, screen-scoped components, contracts)
- **Environment**: Import from `@env/environment` (mapped to `src/environments/`)
- **Type-only imports**: Use `import type { ... }` for types and interfaces

### `tsconfig.json` Paths
```json
"compilerOptions": {
  "paths": {
    "@/*": ["./src/app/*"],
    "@env/*": ["./src/environments/*"]
  }
}
```

### Import Paths by Category
- **Screen components** (routes only): `@/ui/screens/[screen-name]/[screen-name]`
- **Reusable components**: `@/ui/reusables/[component-name]/[component-name]`
- **ViewModels**: `./[component-name].vm` (relative, same folder)
- **Business Objects / Enums**: `@/types/[module]/[name].bo`, `@/types/[module]/[name].enum`
- **BFF Adapter**: `@/services/bff/bff-adapter.service`
- **Generated BFF types**: `@/services/generated/bff.types.gen`
- **Screen Service contract**: `@/services/screens/[name]-screen-service/[name]-screen.contract`
- **Domain Service contract**: `@/services/domains/[entity]-domain-service/[entity]-domain.contract`
- **Platform/Device Service contract**: `@/services/platform/[name]-service/[name].contract`
- **Global stores**: `@/store/[name].store`
- **ServiceResult helpers**: `@/helpers/service-result/service-result`
- **Logger**: `@/helpers/logging/logger`
- **Validation**: `@/helpers/validation/[validator-name]`
- **Assets**: referenced by URL path in templates (`/images/img-user.svg`), using `NgOptimizedImage`

### Import Ordering (enforced by ESLint / Prettier plugin)
1. Angular core imports (`@angular/*`)
2. External package imports (`@ngrx/signals`, `rxjs`, ...)
3. Internal absolute imports (`@/...`, `@env/...`)
4. Relative imports (same folder)

### Import Examples

```typescript
// ✅ Correct Import Pattern
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { patchState } from '@ngrx/signals';
import { Button } from '@/ui/reusables/button/button';
import type { UserBO } from '@/types/user/user.bo';
import { UserStatusENUM } from '@/types/user/user-status.enum';
import type { components } from '@/services/generated/bff.types.gen';
import { USER_PROFILE_SCREEN_SERVICE } from '@/services/screens/user-profile-screen-service/user-profile-screen.contract';
import { UserProfileScreenViewModel } from './user-profile-screen.vm';

// ❌ Incorrect Import Patterns
import { Button } from '@/ui/reusables';                                  // Barrel export
import { Button } from '@/ui/reusables/button/button.ts';                 // File extension
import { UserBO } from '../../../types/user/user.bo';                     // Deep relative path
import { UserProfileScreenService } from '@/services/.../user-profile-screen.service'; // Concrete class instead of token
```

## Linting and Formatting

### ESLint Configuration
- Use `angular-eslint` with `typescript-eslint` strict type-checked rules
- Enable `@angular-eslint/template/accessibility` rules
- Enable `@angular-eslint/prefer-on-push-component-change-detection`, `prefer-signals`, and `template/prefer-control-flow`
- No `any`; explicit return types on functions and public methods
- Enforce import ordering and ban barrel imports (`no-restricted-imports`)

### Prettier Configuration
- 2 spaces for indentation
- Single quotes for strings
- Trailing commas where valid
- Semicolons required
- Line length: 100 characters
- Angular HTML parser for `.html` templates

### Pre-commit Requirements
- ESLint must pass with no errors
- Prettier must format all files
- `ng build` (TypeScript + template type-checking with `strictTemplates`) must succeed
- No `console.log` statements in production code

## Anti-Patterns to Avoid

### Naming Anti-Patterns
- PascalCase or snake_case file/folder names (`UserProfile.ts`, `user_profile/`)
- File name not matching the main class
- Legacy `.component.ts` / `Component` suffixes mixed with the new convention in the same project
- Inconsistent suffix usage (mixing `BO`, `Bo`, `bo`)
- `$` suffix on signals, or missing `$` on observables
- Output names prefixed with `on`
- Generic names without context (`Data`, `Info`, `Item`, `utils.ts`)
- Selectors without the app prefix

### Import Anti-Patterns
- Using or creating `index.ts` barrel exports
- Deep relative chains (`../../../`) instead of the `@/` alias
- Importing concrete service classes instead of their injection tokens
- Importing screen components anywhere except `app.routes.ts`
- Importing screen-scoped components from another screen
- Wildcard imports (`import * as`) except for generated types
