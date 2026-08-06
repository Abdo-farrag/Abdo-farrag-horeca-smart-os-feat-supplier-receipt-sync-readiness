import { apiFetch } from './client.js';

export async function login(password: string): Promise<void> {
  await apiFetch<undefined>('/api/overview-access/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function logout(): Promise<void> {
  await apiFetch<undefined>('/api/overview-access/logout', { method: 'POST' });
}

export async function checkSession(): Promise<{ authenticated: boolean }> {
  const result = await apiFetch<{ data: { authenticated: boolean } }>(
    '/api/overview-access/session',
  );
  return result.data;
}
