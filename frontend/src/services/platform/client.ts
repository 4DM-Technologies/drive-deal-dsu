import type { DriveDealClient } from '@/services/generated/client';
import { mockClient } from '@/services/mocks/mockClient';
import { httpClient } from '@/services/platform/httpClient';

// Demo mode makes the complete UX explorable without cloud credentials.
export const client: DriveDealClient = import.meta.env.VITE_USE_MOCKS === 'false' ? httpClient : mockClient;
