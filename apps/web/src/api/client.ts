import {
  authStatusSchema,
  meLeaguesResponseSchema,
  type AuthStatus,
  type MeLeaguesResponse,
} from '@fcm/contracts';

/** Error carrying the HTTP status so callers can special-case 401, etc. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function getValidated<T>(url: string, parse: (data: unknown) => T): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new ApiRequestError(res.status, `Request to ${url} failed with ${res.status}`);
  }
  return parse(await res.json());
}

export function getAuthStatus(): Promise<AuthStatus> {
  return getValidated('/auth/status', (d) => authStatusSchema.parse(d));
}

export function getMyLeagues(): Promise<MeLeaguesResponse> {
  return getValidated('/api/me/leagues', (d) => meLeaguesResponseSchema.parse(d));
}

export async function logout(): Promise<void> {
  const res = await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  if (!res.ok) {
    throw new ApiRequestError(res.status, 'Logout failed');
  }
}

/** Full-page navigation to begin Yahoo OAuth (server issues the redirect). */
export const YAHOO_LOGIN_URL = '/auth/yahoo';
