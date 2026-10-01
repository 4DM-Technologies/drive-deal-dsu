import type { DriveDealClient } from '@/services/generated/client';
import { mockClient } from '@/services/mocks/mockClient';
import { httpClient } from '@/services/platform/httpClient';

// Marketplace demo data can stay local while identity and support operations use the real API.
// This keeps support profiles and submitted tickets sourced from PostgreSQL in every mode.
export const client: DriveDealClient = import.meta.env.VITE_USE_MOCKS === 'false'
  ? httpClient
  : { ...mockClient, auth: httpClient.auth, support: httpClient.support };
