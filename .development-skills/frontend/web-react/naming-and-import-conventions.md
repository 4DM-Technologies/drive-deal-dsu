---
title: React Naming and Import Conventions Guidelines
inclusion: auto
name: react-naming-imports
description: Comprehensive naming patterns for folders, files, code elements, and types plus import conventions with path aliases and file extensions. Use when setting up project structure, organizing files, or establishing import standards.
---

# Naming and Import Conventions Guidelines

## Context & Aim

**Goal**: Establish comprehensive naming patterns and import standards across React applications for consistent code style, maintainability, and developer experience.

**Standard**: Clear, predictable naming with direct file imports, explicit extensions, and organized path structure.

**Impact**: Consistent conventions reduce cognitive load, improve IDE support, build performance, and enable seamless team collaboration.

## Naming Conventions

### Folder Naming
- **Directories**: Use camelCase for all folder names
- **Screen folders**: PascalCase to match component name (e.g., `UserManagementScreen/`)
- **Screen Service folders**: camelCase, component name + `ScreenService` (e.g., `userProfileScreenService/`)
- **Domain Service folders**: camelCase, entity name + `DomainService` (e.g., `userDomainService/`)
- **Platform/Device Service folders**: camelCase ending with `Service` (e.g., `cameraService/`, `authService/`)
- **Module folders**: camelCase for module names (e.g., `user/`, `authentication/`)
- **Asset folders**: lowercase with hyphens for multi-word (e.g., `user-avatars/`)

### File Naming
- **Components**: PascalCase matching component name + `.tsx` (e.g., `UserProfile.tsx`)
- **ViewModels**: PascalCase matching component + `.vm.ts` (e.g., `UserProfile.vm.ts`)
- **Types**: PascalCase with suffix + `.ts` (e.g., `UserBO.ts`, `CreateUserRequestDTO.ts`)
- **Screen Services**: PascalCase + `ScreenService.ts` (e.g., `UserProfileScreenService.ts`, `IUserProfileScreenService.ts`)
- **Domain Services**: PascalCase entity + `DomainService.ts` (e.g., `UserDomainService.ts`, `IUserDomainService.ts`)
- **Platform/Device Services**: PascalCase + `Service.ts` (e.g., `CameraService.ts`, `IAuthService.ts`)
- **Mock Services**: `Mock` prefix + service class name (e.g., `MockUserProfileScreenService.ts`)
- **Generated Types**: `bff.types.gen.ts` — never rename or edit manually
- **Utilities**: camelCase + `.ts` (e.g., `dateUtils.ts`, `validationHelpers.ts`)
- **Configuration**: camelCase + `.ts` (e.g., `apiConfig.ts`, `appSettings.ts`)
- **Assets**: Prefixed with type + hyphen + name
  - Images: `img-{name}.{ext}` (e.g., `img-user-avatar.svg`, `img-company-logo.png`)
  - Videos: `video-{name}.{ext}` (e.g., `video-intro.mp4`, `video-tutorial.webm`)
  - Lottie: `lottie-{name}.json` (e.g., `lottie-loading.json`, `lottie-success.json`)
  - Audio: `audio-{name}.{ext}` (e.g., `audio-notification.mp3`, `audio-alert.wav`)
  - Icons: `img-{name}.svg` (e.g., `img-search.svg`, `img-edit.svg`)

### Code Element Naming
- **Components**: PascalCase (e.g., `UserProfile`, `SearchModal`)
- **Functions/Methods**: camelCase (e.g., `getUserData`, `handleSubmit`)
- **Variables**: camelCase (e.g., `isLoading`, `userList`)
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `API_BASE_URL`, `MAX_RETRY_COUNT`)
- **Custom Hooks**: camelCase starting with "use" (e.g., `useAuth`, `useUserData`)

### Type Naming
- **Business Objects**: PascalCase + "BO" suffix (e.g., `UserBO`, `ProductBO`)
- **Data Transfer Objects**: PascalCase + "DTO" suffix (e.g., `CreateUserRequestDTO`)
- **Enums**: PascalCase + "ENUM" suffix (e.g., `UserStatusENUM`)
- **Interfaces**: PascalCase with "I" prefix (e.g., `IUserService`)
- **UI Types**: PascalCase + "UI" suffix when extending BOs (e.g., `UserUI`)

## Import Conventions

### Core Import Rules
- **Direct File Imports**: Always import directly from files, never use `index.ts` barrel exports
- **File Extensions**: Include file extensions (`.tsx`, `.ts`) in all imports
- **Path Aliases**: Use `@/` alias for imports from `src/` directory
- **Relative Imports**: Use relative imports only for same-directory files (ViewModels, co-located files)
- **Import Names**: Import names must match exported names exactly

### Import Paths by Category
- **Screen components**: `@/ui/screens/[ScreenName]/[ScreenName].tsx`
- **Reusable components**: `@/ui/reusables/[ComponentName]/[ComponentName].tsx`
- **ViewModels**: `./[ComponentName].vm.ts` (relative from same directory)
- **Business Objects**: `@/types/[module]/[TypeName].ts`
- **BFF Adapter**: `@/services/bff/BffAdapter.ts`
- **Generated BFF types**: `@/services/generated/bff.types.gen.ts`
- **Screen Service interface**: `@/services/screens/[screenName]ScreenService/I[ScreenName]ScreenService.ts`
- **Screen Service**: `@/services/screens/[screenName]ScreenService/[ScreenName]ScreenService.ts`
- **Domain Service interface**: `@/services/domains/[entity]DomainService/I[Entity]DomainService.ts`
- **Domain Service**: `@/services/domains/[entity]DomainService/[Entity]DomainService.ts`
- **Platform/Device Service**: `@/services/platform/[name]Service/[Name]Service.ts`
- **ServiceResult helpers**: `@/helpers/serviceResult/serviceResultHelpers.ts`
- **Utilities**: `@/helpers/utilities/[utilityName].ts`
- **Validation**: `@/helpers/validation/[validationName].ts`
- **Configuration**: `@/helpers/config/[configName].ts`
- **Custom Hooks**: `@/helpers/hooks/[hookName].ts`
- **Assets**: `@/assets/images/[asset-name].[ext]` (default imports for SVG icons)

### Import Ordering (Auto-sorted by Prettier)
1. React core imports (`react`, `react-dom`)
2. External package imports (third-party libraries)
3. Internal absolute imports (with `@/` alias)
4. Relative imports (same directory files)

### Import Examples

```typescript
// ✅ Correct Import Pattern
import { useState } from "react";                                    // React core
import { Button } from "@/ui/reusables/Button/Button.tsx";          // Reusable component
import { UserBO } from "@/types/user/UserBO.ts";                    // Business Object
import type { components } from "@/services/generated/bff.types.gen.ts";                      // BFF types
import { UserStatusENUM } from "@/types/user/UserStatusENUM.ts";    // Enum
import imgUserIcon from "@/assets/images/img-user.svg";             // Asset
import { useUserProfile } from "./UserProfile.vm.ts";              // ViewModel (relative)

// ❌ Incorrect Import Patterns
import { Button } from "@/ui/reusables/Button";                     // Missing extension
import { UserBO } from "@/types/user/UserBO";                      // Missing extension
import { Button } from "@/ui/reusables/Button/index";              // Barrel export
import { useUserProfile } from "../UserProfile/UserProfile.vm.ts"; // Should be relative
```

## Linting and Formatting

### ESLint Configuration
- Use strict TypeScript rules with no `any` types
- Enforce consistent import ordering
- Require explicit return types for functions
- Enforce accessibility rules for React components
- Use React Hooks rules for proper hook usage

### Prettier Configuration
- 2 spaces for indentation
- Single quotes for strings
- Trailing commas where valid
- Semicolons required
- Line length: 100 characters
- Auto-sort imports by type (React, external, internal, relative)

### Pre-commit Requirements
- ESLint must pass with no errors
- Prettier must format all files
- TypeScript compilation must succeed
- No console.log statements in production code

## Anti-Patterns to Avoid

### Naming Anti-Patterns
- Mixed case in folder names (e.g., `UserService/`, `user_service/`)
- Inconsistent file extensions (missing `.tsx` or `.ts`)
- Random capitalization in asset files (e.g., `SearchIcon.svg`)
- Abbreviations without clear meaning (e.g., `usr`, `prod`)
- Inconsistent suffix usage (mixing `BO`, `Bo`, `bo`)
- Snake_case in JavaScript/TypeScript code (except constants)
- Spaces in file or folder names
- Special characters in names (except hyphens in assets)
- Inconsistent hook naming (not starting with "use")
- Generic names without context (e.g., `Data`, `Info`, `Item`)

### Import Anti-Patterns
- Using `index.ts` barrel exports or creating barrel exports to "simplify" imports
- Importing without file extensions or using inconsistent path aliases
- Using relative paths for distant files instead of `@/` alias
- Mixing import styles within same file or using wildcard imports unnecessarily
- Importing from parent directories with `../../../` chains
- Importing components from wrong directories (e.g., importing screens from reusables)