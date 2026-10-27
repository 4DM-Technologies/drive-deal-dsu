---
title: Angular State Management Guidelines
inclusion: fileMatch
fileMatchPattern: "**/store/**,**/*.store.ts,**/*.vm.ts"
---

# State Management Guidelines

## Context & Aim

**Goal**: Manage Angular application state efficiently with clear separation between screen-level, global, and complex feature state.

**Standard**: Angular signals (`signal`, `computed`, `linkedSignal`) inside component-scoped ViewModels for screen state; **NgRx SignalStore** (`@ngrx/signals`) for global state; a Mediator pattern for complex ViewModels.

**Impact**: Signals give fine-grained, zoneless-friendly updates; a single global-state approach prevents ad-hoc shared services, and the Mediator keeps large features maintainable.

## Guidelines and Patterns to Follow

### State Classification
- **Screen-Level State**: Specific to one screen, held as signals in the screen ViewModel (component-provided)
- **Global Reactive State**: Shared across screens, triggers UI updates — NgRx SignalStore `providedIn: 'root'`, read via its signals
- **Global Non-Reactive State**: Shared across screens, read on demand — same SignalStore, read with `untracked()` or inside methods (no template binding)
- **Complex Feature State**: ViewModels over 500 lines split into sub-ViewModels coordinated by a Mediator with a shared state class

### State Classification Examples
| Type | Characteristics | Managed In | Example |
|------|-----------------|------------|---------|
| **Screen-Level State** | Specific to one screen; destroyed when the screen is left | ViewModel (`signal`) | Form inputs, dialog open flags, screen filters |
| **Global Reactive State** | Shared across screens; UI updates automatically | SignalStore (root) | Notifications, theme, current user badge |
| **Global Non-Reactive State** | Shared across screens; read when needed | SignalStore (root), read with `untracked()` | Feature flags, static configuration, cached profile |
| **Complex Feature State** | Feature logic exceeding 500 lines | Mediator + shared state + sub-ViewModels | Multi-step workflows, dashboards |

### Decision Flow
1. **Start with Scope:** Is the state specific to one screen or shared across screens?
   - **Screen-specific** → signals in the screen ViewModel
   - **Shared across screens** → global SignalStore in `store/`
2. **For Global State:** Does it need to update UI automatically?
   - **Yes** → Bind the store's signals in templates/`computed()`
   - **No** → Read inside methods or with `untracked()`
3. **For ViewModel Size:** Is the ViewModel exceeding 500 lines?
   - **Yes** → Mediator pattern
   - **No** → Single ViewModel

### Signal Rules
- `signal()` for writable state; expose it read-only with `.asReadonly()`
- `computed()` for everything derived — never store derived data in a separate writable signal
- `linkedSignal()` for writable state that resets when a source changes (e.g., selected item when the list changes)
- `effect()` only for side effects that leave Angular (logging, `localStorage`, third-party widgets) — never to copy one signal into another
- Update immutably: `this.users.update((list) => [...list, user])` — never mutate arrays/objects in place
- Use `toSignal()` to bring an Observable (router params, form `valueChanges`) into signal state

---

## Screen ViewModel Pattern

### ViewModel (`user-profile-screen.vm.ts`)
```typescript
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ServiceResultStatusENUM } from '@/helpers/service-result/service-result-status.enum';
import { Logger } from '@/helpers/logging/logger';
import { USER_PROFILE_SCREEN_SERVICE } from '@/services/screens/user-profile-screen-service/user-profile-screen.contract';
import type { UserBO } from '@/types/user/user.bo';

@Injectable()
export class UserProfileScreenViewModel {
  private readonly screenService = inject(USER_PROFILE_SCREEN_SERVICE);
  private readonly router = inject(Router);
  private readonly logger = inject(Logger);

  private readonly _user = signal<UserBO | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly user = this._user.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly displayName = computed(() => this._user()?.name ?? '');

  async loadUser(userId: string): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);
    try {
      const result = await this.screenService.getUserProfile(userId);
      if (result.statusCode === ServiceResultStatusENUM.OK && result.data) {
        this._user.set(result.data);
      } else {
        this._error.set(result.message);
      }
    } catch (e) {
      this.logger.error('UserProfileScreenViewModel.loadUser: unexpected error', { error: (e as Error).message });
      this._error.set('Unexpected error loading the profile.');
    } finally {
      this._isLoading.set(false);
    }
  }

  async goToEdit(): Promise<void> {
    await this.router.navigate(['/user-profile', this._user()?.id, 'edit']);
  }
}
```

### Screen Component (`user-profile-screen.ts`)
```typescript
@Component({
  selector: 'app-user-profile-screen',
  templateUrl: './user-profile-screen.html',
  styleUrl: './user-profile-screen.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [UserProfileScreenViewModel],
})
export class UserProfileScreen implements OnInit {
  protected readonly vm = inject(UserProfileScreenViewModel);
  readonly userId = input.required<string>(); // bound from the route via withComponentInputBinding()

  ngOnInit(): void {
    void this.vm.loadUser(this.userId());
  }
}
```

```html
@if (vm.isLoading()) {
  <app-spinner aria-live="polite" />
} @else if (vm.error(); as error) {
  <p role="alert">{{ error }}</p>
} @else if (vm.user(); as user) {
  <h1>{{ vm.displayName() }}</h1>
}
```

---

## Global State with NgRx SignalStore

### Directory Structure
```
src/app/store/
├── admin-profile.store.ts      ← domain store: admin profile
├── user-profile.store.ts       ← domain store: user profile
├── notifications.store.ts      ← purpose store: notifications
└── theme.store.ts              ← purpose store: theme
```

### Store Pattern (`store/admin-profile.store.ts`)
Each store owns one domain or purpose. Stores hold state and synchronous updaters only — they do not call services.
```typescript
import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import type { AdminProfileBO } from '@/types/admin-profile/admin-profile.bo';

interface AdminProfileState {
  profile: AdminProfileBO | null;
  isLoaded: boolean;
}

const initialState: AdminProfileState = {
  profile: null,
  isLoaded: false,
};

export const AdminProfileStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ profile }) => ({
    displayName: computed(() => profile()?.name ?? ''),
  })),
  withMethods((store) => ({
    setAdminProfile(profile: AdminProfileBO): void {
      patchState(store, { profile, isLoaded: true });
    },
    clearAdminProfile(): void {
      patchState(store, initialState);
    },
  })),
);
```

### Using Global State in ViewModels
ViewModels call services, then write results to the store:
```typescript
@Injectable()
export class DashboardScreenViewModel {
  private readonly adminProfileStore = inject(AdminProfileStore);
  private readonly screenService = inject(DASHBOARD_SCREEN_SERVICE);

  readonly adminName = this.adminProfileStore.displayName; // reactive

  async loadProfile(): Promise<void> {
    if (this.adminProfileStore.isLoaded()) return;
    const result = await this.screenService.getAdminProfile();
    if (result.statusCode === ServiceResultStatusENUM.OK && result.data) {
      this.adminProfileStore.setAdminProfile(result.data);
    }
  }
}
```

### Non-Reactive Global State (Lazy Read)
Read the current value inside a method or with `untracked()` so no reactive dependency is created:
```typescript
const currentProfile = untracked(() => this.adminProfileStore.profile());
```

---

## ViewModel Size Management
- Keep individual ViewModels under 500 lines of code
- Break large ViewModels into feature-based sub-ViewModels
- Use a Mediator ViewModel to coordinate sub-ViewModels
- The screen component injects only the Mediator, never sub-ViewModels

### Mediator Pattern Implementation
- Put shared state in a component-provided **state class** (`user-management-screen.state.ts`) holding signals
- Sub-ViewModels inject the state class and implement one concern each (list, form, search)
- The Mediator injects the state class and all sub-ViewModels and exposes one unified API to the view
- Sub-ViewModels never inject each other — they communicate only through the shared state or the Mediator
- Provide all of them at the screen: `providers: [UserManagementState, UserListViewModel, UserFormViewModel, UserSearchViewModel, UserManagementScreenViewModel]`

### Mediator Pattern Example
```typescript
// Shared state — single source of truth for the feature
@Injectable()
export class UserManagementState {
  readonly users = signal<UserBO[]>([]);
  readonly selectedUser = signal<UserBO | null>(null);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);
}

// Sub-ViewModel — one concern
@Injectable()
export class UserListViewModel {
  private readonly state = inject(UserManagementState);
  private readonly screenService = inject(USER_MANAGEMENT_SCREEN_SERVICE);
  private readonly logger = inject(Logger);

  async loadUsers(): Promise<void> {
    this.state.isLoading.set(true);
    try {
      const result = await this.screenService.getUsers();
      if (result.statusCode === ServiceResultStatusENUM.OK) {
        this.state.users.set(result.data ?? []);
      } else {
        this.state.error.set(result.message);
      }
    } catch (e) {
      this.logger.error('UserListViewModel.loadUsers: unexpected error', { error: (e as Error).message });
      this.state.error.set('Unexpected error loading users.');
    } finally {
      this.state.isLoading.set(false);
    }
  }

  selectUser(user: UserBO): void {
    this.state.selectedUser.set(user);
  }
}

// Mediator — the only VM the screen injects
@Injectable()
export class UserManagementScreenViewModel {
  private readonly state = inject(UserManagementState);
  private readonly listVM = inject(UserListViewModel);
  private readonly formVM = inject(UserFormViewModel);
  private readonly searchVM = inject(UserSearchViewModel);

  readonly users = this.state.users.asReadonly();
  readonly selectedUser = this.state.selectedUser.asReadonly();
  readonly isLoading = this.state.isLoading.asReadonly();
  readonly error = this.state.error.asReadonly();

  readonly loadUsers = (): Promise<void> => this.listVM.loadUsers();
  readonly selectUser = (user: UserBO): void => this.listVM.selectUser(user);
  readonly saveUser = (): Promise<void> => this.formVM.save();
  readonly search = (term: string): void => this.searchVM.search(term);
}
```

---

## RxJS Usage
- Prefer signals and promise-based services; use RxJS only for genuine streams (typeahead debounce, WebSockets, polling, router events)
- In SignalStores, use `rxMethod()` from `@ngrx/signals/rxjs-interop` for stream-driven methods
- Every manual `subscribe()` must use `takeUntilDestroyed()`
- Convert streams to signals with `toSignal()` at the ViewModel boundary — templates read signals, not `async` pipes

---

## Anti-Patterns to Avoid

- ViewModels exceeding 500 lines without the Mediator pattern
- Screen ViewModels provided in `root` (state survives navigation and leaks between users)
- Using a global store for screen-specific data
- Shared mutable state in plain `@Injectable({ providedIn: 'root' })` services instead of a SignalStore
- Mixing state approaches (classic NgRx Store, `BehaviorSubject` services, and SignalStore) in one app
- Stores calling services or `HttpClient` — ViewModels call services and write results to stores
- Storing derived data in state instead of `computed()` / `withComputed()`
- Using `effect()` to synchronize signals
- Mutating signal values in place (`this.users().push(x)`)
- Sub-ViewModels injecting each other
- Screen components injecting sub-ViewModels directly
- Exposing writable signals publicly from a ViewModel
