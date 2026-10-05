interface FrontendEnvironment {
  apiBaseUrl: string;
  websocketBaseUrl: string;
}

function requiredEnvironmentValue(key: 'VITE_API_BASE_URL' | 'VITE_WS_BASE_URL'): string {
  const value = import.meta.env[key]?.trim();
  if (!value) throw new Error(`${key} must be configured before the application starts.`);
  return value.replace(/\/$/, '');
}

export const environment: Readonly<FrontendEnvironment> = Object.freeze({
  apiBaseUrl: requiredEnvironmentValue('VITE_API_BASE_URL'),
  websocketBaseUrl: requiredEnvironmentValue('VITE_WS_BASE_URL'),
});
