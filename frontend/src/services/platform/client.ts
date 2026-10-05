import type { DriveDealClient } from '@/services/generated/client';
import { httpClient } from '@/services/platform/httpClient';

export const client: DriveDealClient = httpClient;
