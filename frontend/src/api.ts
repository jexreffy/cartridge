/**
 * Authenticated fetch wrapper — injects the Cognito IdToken as Bearer token.
 * All API calls should use apiFetch instead of raw fetch.
 */

import { getIdToken } from './auth';

export const API = import.meta.env.VITE_API_URL ?? '/api';

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getIdToken();
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}
