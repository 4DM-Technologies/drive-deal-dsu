---
title: React MVVM Architecture and Component Structure Guidelines
inclusion: auto
name: react-mvvm-architecture
description: MVVM-inspired architecture with View, ViewModel, Service, and Type layers plus component classification decision tree for Screens, Inline, Basic Reusables, and Self-Contained components. Use when designing application structure or deciding component architecture.
---


# MVVM Architecture and Component Structure Guidelines

## Context & Aim

**Goal**: Implement MVVM-inspired architecture with clear component segregation and maintainable separation of concerns.

**Standard**: ViewModels handle business logic, Views handle presentation, Services manage data access, with progressive component enhancement approach.

**Impact**: Clear separation improves testability, maintainability, prevents over-abstraction, and enables scalable team collaboration.

## MVVM Architecture Pattern

### Core Architecture Layers
- **Views (UI)**: Visual layer - screens and components
- **ViewModels (Logic)**: Business logic, state management, and data transformation
- **Services**: Backend communication, API integration, and data access
- **Types**: Business Objects (BOs) and data structures (no separate Model classes needed in React)

### Directory Structure Overview
```
src/
├── ui/
│   ├── navigations/        # Routing configuration
│   ├── screens/            # Full-page components with ViewModels
│   └── reusables/          # Shared UI components
├── services/
│   ├── bff/                # BFF Adapter — single HTTP client for all BFF calls
│   ├── generated/          # AUTO-GENERATED BFF types from /docs/json (never edit manually)
│   ├── screens/            # Screen Services — read-only, mirrors BFF api/screens/
│   ├── domains/            # Domain Services — mutations, mirrors BFF api/domains/
│   └── platform/           # Platform/Device Services — no BFF involvement
├── types/                  # Domain-specific Business Objects and Enums
├── helpers/                # Shared utilities, serviceResult helpers, logging, validation
└── assets/                 # Static assets
```

## Component Classification and Decision Tree

### Component Classification Decision Tree

When creating any UI element, follow this decision tree:

```
Is this a full-page view?
├─ YES → Create as SCREEN in ui/screens/
└─ NO → Is it reusable across multiple screens?
    ├─ YES → Does it need complex logic/state/API calls?
    │   ├─ YES → Create as SELF-CONTAINED REUSABLE in ui/reusables/ with ViewModel
    │   └─ NO → Create as BASIC REUSABLE in ui/reusables/ (stateless/minimal state)
    └─ NO → Create as INLINE COMPONENT within the screen's .tsx file
```

### Component Types and Structure

#### Screen Components
- **Location**: `ui/screens/ScreenName/`
- **Structure**: `ScreenName.tsx` (view + inline components) + `ScreenName.vm.ts` (logic)
- **Characteristics**: Full page/route, complex state, always has ViewModel
- **File Organization**: Each screen has separate `.tsx` and `.vm.ts` files

#### Inline Components
- **Location**: INSIDE the main screen component function
- **Access**: ViewModel directly (no prop drilling)
- **Critical**: Must be defined INSIDE main component, not outside
- **Usage**: Screen-specific UI sections, not reusable elsewhere
- **Ordering**: 
  1. Components used in main content (headers, cards, rows) - Define first
  2. Modal/Dialog components - Define last (render at end of JSX)

#### Basic Reusable Components
- **Location**: `ui/reusables/ComponentName/`
- **Structure**: `ComponentName.tsx` + optional tests
- **Characteristics**: Stateless/minimal state, display-only, no ViewModel
- **Examples**: Button, Input, Badge, Modal

#### Self-Contained Reusable Components
- **Location**: `ui/reusables/ComponentName/`
- **Structure**: `ComponentName.tsx` + `ComponentName.vm.ts` + optional tests
- **Characteristics**: Complex logic, API calls, internal state management
- **Examples**: SearchableDropdown, DataTable, FileUploader

## Layer Responsibilities

### ViewModel Responsibilities (High-Level)
- State management using React hooks
- Business logic and data transformation
- API service calls coordination
- Form validation and submission logic
- Navigation and routing logic

### View Responsibilities (High-Level)
- Component rendering and JSX structure
- Event handler binding (calling ViewModel methods)
- Inline component definitions (inside main component)
- Styling and layout (design system components → Tailwind utilities → custom SCSS modules)
- Accessibility attributes
- Only presentation logic in `.tsx` file

### Service Layer Role
- **Screen Services**: Fetch screen-shaped read data from BFF `api/screens/` endpoints — **platform-specific** (web screen shapes differ from mobile shapes; BFF uses `x-client-type` header to serve the right shape)
- **Domain Services**: Execute mutations via BFF `api/domains/` endpoints — **platform-agnostic** (same endpoint contract across React, Flutter, and MAUI)
- **BFF Adapter**: Single axios client handling auth headers, `x-client-type: web`, correlation IDs, and error normalization
- **Generated Types**: All BFF request/response types auto-generated from the BFF OpenAPI spec via `openapi-typescript` — never hand-written; each platform generates its own types
- **Platform/Device Services**: OS and hardware operations with no BFF involvement — same interface contract across platforms, different implementations per platform (React uses browser APIs, Flutter uses packages, MAUI uses .NET APIs)
- Error handling and centralized logging
- Interface-based design with mock/real implementation switching

## Progressive Enhancement Approach

### Component Enhancement Strategy
- Start with inline components for screen-specific UI
- Promote to basic reusable only when used across multiple screens
- Add ViewModels only when complex logic/state/API calls are needed
- Use progressive enhancement to prevent over-abstraction

### Decision Guidelines
1. **Determine reusability**: Multiple screens? → `ui/reusables/`, Single screen? → Inline component
2. **Assess complexity**: Complex logic/state/API calls? → Add ViewModel, Simple display? → Keep stateless
3. **Evaluate scope**: Full-page view? → Screen component, UI section? → Inline or reusable

## Architecture Patterns to Follow

### Separation of Concerns
- Clear separation between Views, ViewModels, and Services
- Views handle only presentation logic
- ViewModels handle business logic and state
- Services handle data access and backend communication

### Component Organization
- Progressive enhancement from inline to reusable components
- ViewModel pattern for complex screens and reusables
- Inline components defined inside main component function
- Screen-specific logic stays in screen ViewModels

### File Organization
- Each screen has separate `.tsx` and `.vm.ts` files
- Direct file imports with extensions
- No barrel exports anywhere
- Co-located files for related functionality

## Anti-Patterns to Avoid

### Architecture Anti-Patterns
- Mixing business logic in View components
- Creating ViewModels for simple stateless components
- Mixing view logic with business logic in screen files
- Importing services directly instead of using interfaces

### Component Anti-Patterns
- Creating separate folders for inline components
- Making components reusable prematurely
- Defining inline components outside main component function
- Prop drilling when ViewModel access is available

### ViewModel Anti-Patterns
- Screen components importing sub-ViewModels directly
- ViewModels handling presentation logic
- Direct DOM manipulation in ViewModels

This architecture ensures maintainable code while preventing over-abstraction and maintaining clear separation of concerns throughout the React application.