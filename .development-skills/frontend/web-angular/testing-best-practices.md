---
title: Angular Testing Best Practices Guidelines
inclusion: fileMatch
fileMatchPattern: "**/*.spec.ts,**/e2e/**,**/vitest*,**/playwright*,**/test-setup.ts"
---

# Testing Best Practices Guidelines

## Context & Aim

**Goal**: Comprehensive testing standards for Angular applications using the modern Angular testing toolchain.

**Standard**: Vitest (Angular CLI `@angular/build:unit-test` builder) for unit and component tests, Angular Testing Library for component tests, `HttpTestingController` for the BFF Adapter, Playwright for E2E, axe-core for accessibility.

**Impact**: A fast, reliable test suite that catches bugs early, enables confident refactoring, and tests what users actually see.

---

## Guidelines and Patterns to Follow

### Testing Framework Stack
- **Unit + Component Testing**: Vitest via `ng test` (Angular CLI unit-test builder) — not Karma/Jasmine for new projects
- **Component Rendering**: `@testing-library/angular` (`render`, `screen`)
- **User Interactions**: `@testing-library/user-event`
- **HTTP Testing**: `provideHttpClientTesting()` + `HttpTestingController` (BFF Adapter only)
- **Service Mocking in VMs/Components**: DI providers (`{ provide: TOKEN, useValue: mock }`) — not module mocking
- **Property-Based Testing**: `fast-check` for validation logic with wide input ranges
- **E2E Testing**: Playwright
- **Accessibility Testing**: `vitest-axe` (unit) and `@axe-core/playwright` (E2E)

### Test Organization
- **Co-location**: Place spec files next to the source file with the same base name + `.spec.ts` (`user-profile-screen.vm.spec.ts`)
- **E2E**: `e2e/` folder at the project root, one spec per user journey
- **Structure**: `describe` the class/component, `it` describes observable behaviour
- **Naming**: `it('should show error message when service returns NOT_FOUND')` — user-observable, not implementation detail
- **Zoneless**: Tests run zoneless like the app — never use `fakeAsync`/`tick` (zone-based); use `await fixture.whenStable()` and Vitest fake timers

### Angular CLI Configuration (`angular.json`)
```json
"test": {
  "builder": "@angular/build:unit-test",
  "options": {
    "runner": "vitest",
    "setupFiles": ["src/test-setup.ts"],
    "coverage": true
  }
}
```

### Angular Testing Library Best Practices
- **Query priority**: `getByRole` → `getByLabelText` → `getByText` — never `getByTestId` as first choice
- **Async**: use `findBy*` and `waitFor` for async rendering
- **User events**: always use `@testing-library/user-event`, not `fireEvent` or `nativeElement.click()`
- **Test behaviour, not implementation** — do not assert on component fields, private signals, or DOM structure
- **Inputs**: pass with `render(Component, { inputs: { ... } })`; assert outputs with `on: { userSelected: spy }`

---

## Implementation Patterns

### Component Test (presentational)
```typescript
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UserCard } from './user-card';

describe('UserCard', () => {
  it('should display user information', async () => {
    await render(UserCard, { inputs: { user: { id: '1', name: 'Jane Doe', email: 'jane@example.com' } } });
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('should emit editRequested when edit button clicked', async () => {
    const user = userEvent.setup();
    const editRequested = vi.fn();
    await render(UserCard, { inputs: { user: mockUser }, on: { editRequested } });
    await user.click(screen.getByRole('button', { name: 'Edit Profile' }));
    expect(editRequested).toHaveBeenCalledWith(mockUser);
  });
});
```

### ViewModel Test
Mock services through their injection token. Never mock `BffAdapter` or `HttpClient` in VM tests.
```typescript
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

describe('UserProfileScreenViewModel', () => {
  const screenService = { getUserProfile: vi.fn() };
  let vm: UserProfileScreenViewModel;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        UserProfileScreenViewModel,
        provideRouter([]),
        { provide: USER_PROFILE_SCREEN_SERVICE, useValue: screenService },
      ],
    });
    vm = TestBed.inject(UserProfileScreenViewModel);
  });

  it('should load user and clear loading state on success', async () => {
    screenService.getUserProfile.mockResolvedValue({
      statusCode: ServiceResultStatusENUM.OK,
      data: { id: '123', name: 'Jane Doe' },
      message: 'OK',
    });
    await vm.loadUser('123');
    expect(vm.user()).toEqual({ id: '123', name: 'Jane Doe' });
    expect(vm.isLoading()).toBe(false);
    expect(vm.error()).toBeNull();
  });

  it('should set error message when service returns non-OK status', async () => {
    screenService.getUserProfile.mockResolvedValue({
      statusCode: ServiceResultStatusENUM.NOT_FOUND,
      data: null,
      message: 'User not found',
    });
    await vm.loadUser('999');
    expect(vm.error()).toBe('User not found');
  });
});
```

### Screen Test (component + ViewModel, service mocked)
```typescript
it('should show the user name after loading', async () => {
  await render(UserProfileScreen, {
    inputs: { userId: '123' },
    providers: [{ provide: USER_PROFILE_SCREEN_SERVICE, useValue: screenServiceMock }],
  });
  expect(await screen.findByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
});
```

### BFF Adapter Test
```typescript
beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [BffAdapter, provideHttpClient(), provideHttpClientTesting()],
  });
});

it('should map a 404 response to NOT_FOUND ServiceResult', async () => {
  const bff = TestBed.inject(BffAdapter);
  const http = TestBed.inject(HttpTestingController);
  const pending = bff.get('/api/screens/user-profile/999');
  http.expectOne('/api/screens/user-profile/999').flush({ message: 'User not found' }, { status: 404, statusText: 'Not Found' });
  const result = await pending;
  expect(result.statusCode).toBe(ServiceResultStatusENUM.NOT_FOUND);
  http.verify();
});
```

### SignalStore Test
```typescript
it('should mark profile as loaded when set', () => {
  const store = TestBed.inject(AdminProfileStore);
  store.setAdminProfile({ id: '1', name: 'Admin' });
  expect(store.isLoaded()).toBe(true);
  expect(store.displayName()).toBe('Admin');
});
```

### Accessibility Test
```typescript
import { axe } from 'vitest-axe';

it('should have no accessibility violations', async () => {
  const { container } = await render(UserCard, { inputs: { user: mockUser } });
  expect(await axe(container)).toHaveNoViolations();
});
```

### Property-Based Testing (for validation logic)
```typescript
import fc from 'fast-check';

it('should always reject strings without @', () => {
  fc.assert(fc.property(
    fc.string().filter((s) => !s.includes('@')),
    (invalid) => emailValidator(new FormControl(invalid)) !== null,
  ));
});
```

---

## Testing Guidelines by Layer

### BFF Adapter Testing
- Use `HttpTestingController` — never call a real backend
- Test success, 4xx, 5xx, timeout, and network-error paths
- Verify interceptors add `Authorization`, `x-client-type`, and correlation headers
- Call `http.verify()` after each test

### Service Testing
- Mock `BffAdapter` with a `useValue` provider and verify the endpoint and payload each service sends
- Screen services only call `get`; domain services only call `post` / `put` / `patch` / `delete`
- Verify the `ServiceResult<T>` structure: `data`, `message`, `statusCode`

### ViewModel Testing
- Mock services through their `InjectionToken` — never mock `BffAdapter` or `HttpClient`
- Test every public method — success, service error (`NOT_FOUND`, `SERVICE_EXCEPTION`), and unexpected error (rejected promise) paths
- Verify loading state resets in `finally`
- Read signals directly (`vm.isLoading()`); use `TestBed.tick()` when an `effect()` must run

### Component Testing
- Render with Angular Testing Library; provide mocked service tokens, not mocked ViewModels, for screens
- Cover loading, empty, error, and success states
- Test keyboard interaction for interactive components

### E2E Testing
- Playwright with `getByRole` locators; one spec per critical user journey
- Run against mocked services (`useMockServices`) or a dedicated test BFF — never production
- Include an axe scan on every main screen

### Coverage Targets
- 80%+ overall; 90%+ for ViewModels, stores, and critical business logic
- Do not chase coverage — test meaningful scenarios, not implementation lines

---

## Anti-Patterns to Avoid

- Testing implementation details (private signals, component fields, CSS classes) instead of user-observable behaviour
- Using `fireEvent` or `nativeElement.click()` instead of `@testing-library/user-event`
- Using `fakeAsync` / `tick` / `waitForAsync` (zone-based) in a zoneless app
- Mocking `HttpClient` by hand instead of `HttpTestingController`
- ViewModel tests that mock `BffAdapter` instead of the service token
- Using `vi.mock()` on Angular services instead of DI providers
- `NO_ERRORS_SCHEMA` / `CUSTOM_ELEMENTS_SCHEMA` to hide missing imports
- Not testing the error path of service calls
- Skipping accessibility tests for interactive components
- Ignoring async operations — always `await` interactions and pending promises
