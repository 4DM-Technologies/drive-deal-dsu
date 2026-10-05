---
title: React State Management Guidelines
inclusion: fileMatch
fileMatchPattern: "**/store/**,**/*Slice.ts,**/*.vm.ts"
---

# State Management Guidelines

## Context & Aim

**Goal**: Manage React application state efficiently with clear separation between local, global, and complex feature state.

**Standard**: Use appropriate state management patterns based on scope and complexity, with mediator pattern for complex ViewModels and Redux Toolkit for global state.

**Impact**: Proper state management prevents performance issues, maintains code clarity, and enables scalable feature development.

## Guidelines and Patterns to Follow

### State Classification
- **Screen-Level State**: Specific to one screen, managed in ViewModel with useState
- **Global Reactive State**: Shared across screens, triggers automatic UI updates (Redux Toolkit)
- **Global Non-Reactive State**: Shared across screens, no automatic updates (Redux, fetch lazily)
- **Complex Feature State**: Large ViewModels (>500 lines) broken into logical sub-ViewModels with Mediator pattern

### State Classification Examples
| Type | Characteristics | Managed In | Example |
|------|-----------------|------------|---------|
| **Screen-Level State** | Specific to one screen; managed locally for UI or business logic. No sharing across screens. | ViewModel (useState) | Form inputs, toggle flags (modals), screen-specific filters |
| **Global Reactive State** | Shared across multiple screens; triggers automatic UI updates when changed. | Redux Toolkit | Notifications list, theme settings, real-time updates, user activity |
| **Global Non-Reactive State** | Shared across multiple screens; doesn't trigger automatic UI updates. | Redux (fetch lazily) | User profile data, configuration settings, static app-wide data |
| **Complex Feature State** | Large feature logic exceeding 500 lines; broken into coordinated sub-ViewModels. | Mediator + Sub-ViewModels | Complex forms, multi-step workflows, feature dashboards |

### Decision Flow
1. **Start with Scope:** Is the state specific to one screen or shared across multiple screens?
   - **Screen-specific** → Use local state in ViewModel with `useState`
   - **Shared across screens** → Use Redux for global state

2. **For Global State:** Does it need to trigger automatic UI updates?
   - **Yes** → Global Reactive State (Redux with subscriptions via `useAppSelector`)
   - **No** → Global Non-Reactive State (Redux, fetch lazily with `store.getState()`)

3. **For ViewModel Size:** Is the ViewModel exceeding 500 lines?
   - **Yes** → Break into sub-ViewModels with Mediator pattern
   - **No** → Keep as single ViewModel with local state

---

## Redux Toolkit Store Setup

### Directory Structure
```
src/
├── store/
│   ├── store.ts                          ← single store configuration
│   └── hooks.ts                          ← typed useAppSelector / useAppDispatch
├── store/slices/
│   ├── adminProfileSlice.ts              ← domain slice: admin profile
│   ├── userProfileSlice.ts               ← domain slice: user profile
│   ├── notificationsSlice.ts             ← purpose slice: notifications
│   └── themeSlice.ts                     ← purpose slice: theme
```

### Store Configuration (`store/store.ts`)
One store file at the top level. All slices registered here:
```typescript
import { configureStore } from '@reduxjs/toolkit';
import { adminProfileReducer } from '@/store/slices/adminProfileSlice.ts';
// import { userProfileReducer } from '@/store/slices/userProfileSlice.ts';
// import { notificationsReducer } from '@/store/slices/notificationsSlice.ts';
// import { themeReducer } from '@/store/slices/themeSlice.ts';

export const store = configureStore({
  reducer: {
    adminProfile: adminProfileReducer,
    // Add more slices here as needed
    // userProfile: userProfileReducer,
    // notifications: notificationsReducer,
    // theme: themeReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore these action types for serialization checks if needed
        ignoredActions: [],
      },
    }),
  devTools: import.meta.env.MODE !== 'production',
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
```

### Typed Hooks (`store/hooks.ts`)
Always use typed hooks — never raw `useSelector` / `useDispatch`:
```typescript
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '@/store/store.ts';

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
```

### Slice Pattern (`store/slices/{name}Slice.ts`)
Each slice owns one domain or purpose. Slices are grouped by:
- **Domain slices**: entity-specific shared state (e.g., `adminProfileSlice`, `userProfileSlice`)
- **Purpose slices**: cross-cutting concerns (e.g., `notificationsSlice`, `themeSlice`)

```typescript
import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { AdminProfileBO } from '@/types/adminProfile/AdminProfileBO.ts';

interface AdminProfileState {
  profile: AdminProfileBO | null;
  isLoaded: boolean;
}

const initialState: AdminProfileState = {
  profile: null,
  isLoaded: false,
};

const adminProfileSlice = createSlice({
  name: 'adminProfile',
  initialState,
  reducers: {
    setAdminProfile: (state, action: PayloadAction<AdminProfileBO>) => {
      state.profile = action.payload;
      state.isLoaded = true;
    },
    clearAdminProfile: (state) => {
      state.profile = null;
      state.isLoaded = false;
    },
  },
});

export const { setAdminProfile, clearAdminProfile } = adminProfileSlice.actions;
export const adminProfileReducer = adminProfileSlice.reducer;
```

### Using Global State in ViewModels
ViewModels read global state with `useAppSelector` and dispatch with `useAppDispatch`:
```typescript
import { useAppSelector, useAppDispatch } from '@/store/hooks.ts';
import { setAdminProfile } from '@/store/slices/adminProfileSlice.ts';

export const useDashboardScreenViewModel = () => {
  const dispatch = useAppDispatch();
  const adminProfile = useAppSelector((state) => state.adminProfile.profile);

  const loadProfile = async (): Promise<void> => {
    // ... fetch from service
    if (result.statusCode === ServiceResultStatusENUM.OK && result.data) {
      dispatch(setAdminProfile(result.data));
    }
  };

  return { adminProfile, loadProfile };
};
```

### Non-Reactive Global State (Lazy Fetch)
For state that doesn't need to trigger re-renders automatically, read directly from the store:
```typescript
import { store } from '@/store/store.ts';

// Read without subscribing to updates — no re-render on change
const currentProfile = store.getState().adminProfile.profile;
```

### Provider Setup (`main.tsx`)
Wrap the app with the Redux Provider once:
```typescript
import { Provider } from 'react-redux';
import { store } from '@/store/store.ts';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <Provider store={store}>
    <App />
  </Provider>,
);
```

---

## ViewModel Size Management
- Keep individual ViewModels under 500 lines of code
- Break down large ViewModels into logical feature-based sub-ViewModels
- Use Mediator ViewModel pattern to coordinate multiple sub-ViewModels
- Screen/View consumes only the Mediator ViewModel, not sub-ViewModels directly

### Mediator Pattern Implementation
- Create parent Mediator ViewModel that orchestrates sub-ViewModels and holds shared state
- Mediator ViewModel manages primary state using React hooks (useState, useEffect, etc.)
- Sub-ViewModels handle specific feature logic (forms, data fetching, validation)
- Sub-ViewModels access Mediator's state through parameters or React context
- Mediator exposes unified interface to the screen/view component
- Sub-ViewModels communicate through Mediator, not directly with each other
- State flows: Mediator → Sub-ViewModels (read access), Sub-ViewModels → Mediator (updates through callbacks)

### Mediator Pattern Example
```typescript
// Mediator ViewModel - holds all state
const useUserManagementMediator = () => {
  const [users, setUsers] = useState<UserBO[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserBO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sub-ViewModels receive state and setters
  const userListVM = useUserListViewModel({ users, setUsers, setSelectedUser, setLoading, setError });
  const userFormVM = useUserFormViewModel({ selectedUser, setSelectedUser, users, setUsers, setError });
  const userSearchVM = useUserSearchViewModel({ users, setUsers, setLoading, setError });

  return {
    // Expose unified interface
    users,
    selectedUser,
    loading,
    error,
    // Sub-ViewModel actions
    ...userListVM,
    ...userFormVM,
    ...userSearchVM
  };
};

// Sub-ViewModel - receives state from Mediator
const useUserListViewModel = ({ users, setUsers, setSelectedUser, setLoading, setError }: UserListVMParams) => {
  const loadUsers = async () => {
    setLoading(true);
    try {
      const result = await userProfileScreenService.getUsers();
      if (result.statusCode === ServiceResultStatusENUM.OK) {
        setUsers(result.data ?? []);
      } else {
        setError(result.message);
      }
    } catch (e) {
      Logger.error('useUserListViewModel: unexpected error', { error: (e as Error).message });
      setError('Unexpected error loading users.');
    } finally {
      setLoading(false);
    }
  };

  const selectUser = (user: UserBO) => {
    setSelectedUser(user);
  };

  return { loadUsers, selectUser };
};
```

---

## Anti-Patterns to Avoid

- ViewModels exceeding 500 lines without breaking down
- Mixing different concerns in single ViewModel
- Using global state for screen-specific data
- Prop drilling instead of appropriate state management
- Deeply nested Redux state structures
- Sub-ViewModels communicating directly without Mediator
- Using Redux for all state regardless of scope
- Creating global state without clear sharing need
- Using raw `useSelector` / `useDispatch` instead of typed `useAppSelector` / `useAppDispatch`
- Coupling screen components directly to sub-ViewModels
- Putting slice files outside `store/slices/`
- Creating multiple store instances — there is only one store
- Using `createAsyncThunk` for service calls — services are called in ViewModels, results dispatched to slices
- Storing derived/computed data in Redux — compute it in selectors or ViewModels instead
