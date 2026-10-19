/** Badge colour for an AI trace: green when it worked, red when a model call failed, neutral while running. */
export function traceStatusClass(status: string): string {
  if (status === 'success') return 'status-live';
  if (status === 'failed' || status === 'error') return 'status-declined';
  return 'status-draft';
}
