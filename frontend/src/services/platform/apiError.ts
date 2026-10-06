/** Why the API refused a create (HTTP 402 SUBSCRIPTION_REQUIRED). Branch on this, never on the message text. */
export type SubscriptionReason = 'trial_quota_exhausted' | 'trial_expired' | 'premium_expired' | 'request_limit_reached';

/** A failed API call. `message` is the server's human-readable text, so existing `error.message` handling keeps working. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: Record<string, unknown> | null;
  readonly requestId: string | null;

  constructor(message: string, status: number, code: string | null, details: Record<string, unknown> | null, requestId: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Builds the error from the standard `{ error: { code, message, details, request_id } }` envelope. */
  static fromResponse(status: number, body: unknown): ApiError {
    const envelope = (body && typeof body === 'object' ? (body as { error?: unknown }).error : null) as Record<string, unknown> | null;
    const details = envelope?.details && typeof envelope.details === 'object' && !Array.isArray(envelope.details) ? envelope.details as Record<string, unknown> : null;
    return new ApiError(
      typeof envelope?.message === 'string' ? envelope.message : `Request failed (${status})`,
      status,
      typeof envelope?.code === 'string' ? envelope.code : null,
      details,
      typeof envelope?.request_id === 'string' ? envelope.request_id : null,
    );
  }
}
