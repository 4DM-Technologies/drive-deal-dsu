---
title: React Testing Best Practices Guidelines
inclusion: fileMatch
fileMatchPattern: "**/*.test.ts,**/*.test.tsx,**/test/**,**/vitest*,**/*.spec.ts,**/*.spec.tsx"
---

# Testing Best Practices Guidelines

## Context & Aim

**Goal**: Comprehensive testing standards for React applications using modern testing tools.

**Standard**: Vitest for unit/integration tests, React Testing Library for component tests, Playwright/Cypress for E2E, jest-axe for accessibility.

**Impact**: Reliable test suite that catches bugs early, enables confident refactoring, and maintains code quality.

---

## Guidelines and Patterns to Follow

### Testing Framework Stack
- **Unit + Component Testing**: Vitest + React Testing Library
- **User Interactions**: `@testing-library/user-event`
- **API Mocking**: MSW (Mock Service Worker) — not manual mocks
- **Property-Based Testing**: `fast-check` for validation logic with wide input ranges
- **E2E Testing**: Playwright or Cypress
- **Accessibility Testing**: `jest-axe`

### Test Organization
- **Co-location**: Place test files next to source with `.test.tsx` / `.test.ts` suffix
- **Structure**: `describe` / `it` blocks — describe the component/hook, `it` describes observable behaviour
- **Naming**: `it('should show error message when service returns 401')` — user-observable, not implementation detail

### Vitest Configuration
```typescript
// vitest.config.ts
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], globals: true },
});
```

### React Testing Library Best Practices
- **Query priority**: `getByRole` → `getByLabelText` → `getByText` — never `getByTestId` as first choice
- **Async**: use `waitFor` and `findBy*` for async operations
- **User events**: always use `@testing-library/user-event`, not `fireEvent`
- **Test behaviour, not implementation** — do not assert on internal state or component structure

---

## Implementation Patterns

### Component Test
```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

describe('UserProfile', () => {
  it('should display user information', () => {
    render(<UserProfile user={{ name: 'Jane Doe', email: 'jane@example.com' }} />);
    expect(screen.getByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('should call onEdit when edit button clicked', async () => {
    const user = userEvent.setup();
    const mockOnEdit = vi.fn();
    render(<UserProfile user={mockUser} onEdit={mockOnEdit} />);
    await user.click(screen.getByRole('button', { name: 'Edit Profile' }));
    expect(mockOnEdit).toHaveBeenCalledWith(mockUser);
  });
});
```

### ViewModel Test
Services are imported as singletons — mock them at the module level with `vi.mock`. Never mock `bffAdapter` directly.

```typescript
import { userProfileScreenService } from '@/services/screens/userProfileScreenService/UserProfileScreenService.ts';

vi.mock('@/services/screens/userProfileScreenService/UserProfileScreenService.ts', () => ({
  userProfileScreenService: {
    getUserProfile: vi.fn(),
  },
}));

describe('useUserProfile', () => {
  it('should load user data and update state on success', async () => {
    vi.mocked(userProfileScreenService.getUserProfile).mockResolvedValue({
      statusCode: ServiceResultStatusENUM.OK,
      data: { name: 'Jane Doe' },
      message: 'OK',
    });
    const { result } = renderHook(() => useUserProfileViewModel());
    await act(async () => { await result.current.loadUser('123'); });
    expect(result.current.user).toEqual({ name: 'Jane Doe' });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should set error message when service returns non-OK status', async () => {
    vi.mocked(userProfileScreenService.getUserProfile).mockResolvedValue({
      statusCode: ServiceResultStatusENUM.NOT_FOUND,
      data: null,
      message: 'User not found',
    });
    const { result } = renderHook(() => useUserProfileViewModel());
    await act(async () => { await result.current.loadUser('999'); });
    expect(result.current.error).toBe('User not found');
  });
});
```

### Accessibility Test
```typescript
import { axe, toHaveNoViolations } from 'jest-axe';
expect.extend(toHaveNoViolations);

it('should have no accessibility violations', async () => {
  const { container } = render(<MyComponent />);
  expect(await axe(container)).toHaveNoViolations();
});
```

### Property-Based Testing (for validation logic)
Use `fast-check` when a function must hold a property across a wide range of inputs — particularly validation helpers, formatters, and pure transformations:
```typescript
import fc from 'fast-check';

it('should always return false for strings without @', () => {
  fc.assert(fc.property(
    fc.string().filter(s => !s.includes('@')),
    (invalid) => validateEmail(invalid).isValid === false
  ));
});
```

---

## Testing Guidelines by Layer

### Service Testing
- Mock external HTTP with MSW — not manual axios mocks
- Test both success (`ServiceResultStatusENUM.OK`) and error (`NOT_FOUND`, `SERVICE_EXCEPTION`) paths
- Verify the `ServiceResult<T>` structure: `data`, `message`, `statusCode`

### ViewModel Testing
- Mock services at the module level using `vi.mock()` — services are singletons (Option A injection)
- Never mock `bffAdapter` directly — always mock the service that wraps it
- Test every public method — success, service error (`NOT_FOUND`, `SERVICE_EXCEPTION`), and unexpected error paths
- Verify loading state resets in `finally`

### Coverage Targets
- 80%+ overall; 90%+ for ViewModels and critical business logic
- Do not chase coverage — test meaningful scenarios, not implementation lines

---

## Anti-Patterns to Avoid

- Testing implementation details instead of user-observable behaviour
- Using `fireEvent` instead of `@testing-library/user-event`
- Manually mocking axios instead of using MSW
- Writing ViewModel tests that bypass the service interface (mock `bffAdapter` directly)
- Not testing the error path of service calls
- Skipping accessibility tests for interactive components
- Ignoring async operations — always `await` async interactions and state changes
