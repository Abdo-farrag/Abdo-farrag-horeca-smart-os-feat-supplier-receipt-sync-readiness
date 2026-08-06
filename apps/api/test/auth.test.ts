import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuthDependencies } from '../src/auth/types.js';

const reviewerId = '11111111-1111-1111-1111-111111111111';
const adminId = '22222222-2222-2222-2222-222222222222';
const inactiveId = '33333333-3333-3333-3333-333333333333';

function dependencies(overrides?: Partial<AuthDependencies>): AuthDependencies {
  return {
    overviewPasswordHash: '$2b$04$72w1q10X84ftozhW1n17Ne.8wGyu2HspLzW0AA3H0s4jQmVrYQYvW',
    sessionSecret: '0123456789abcdef0123456789abcdef',
    overviewAuthDisabled: false,
    verifyAccessToken: async (token) => {
      if (token === 'reviewer-token') return { userId: reviewerId };
      if (token === 'admin-token') return { userId: adminId };
      if (token === 'inactive-token') return { userId: inactiveId };
      return null;
    },
    findUserRole: async (userId) => {
      if (userId === reviewerId) return { userId, displayName: 'Reviewer', role: 'reviewer', isActive: true };
      if (userId === adminId) return { userId, displayName: 'Admin', role: 'admin', isActive: true };
      if (userId === inactiveId) return { userId, displayName: 'Inactive', role: 'reviewer', isActive: false };
      return null;
    },
    ...overrides,
  };
}

describe('overview shared-password access', () => {
  it('creates an eight-hour secure session for the correct password', async () => {
    const app = buildApp({ auth: dependencies() });
    const response = await app.inject({
      method: 'POST',
      url: '/api/overview-access/login',
      payload: { password: 'correct-password' },
    });

    expect(response.statusCode).toBe(204);
    const cookie = response.headers['set-cookie'];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=28800');
    expect(cookie).not.toContain('correct-password');
  });

  it('rejects an incorrect password without exposing it', async () => {
    const app = buildApp({ auth: dependencies() });
    const response = await app.inject({
      method: 'POST',
      url: '/api/overview-access/login',
      payload: { password: 'wrong-secret' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('wrong-secret');
  });

  it('rate limits the sixth failed attempt from one IP', async () => {
    const app = buildApp({ auth: dependencies() });
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/overview-access/login',
        remoteAddress: '10.0.0.8',
        payload: { password: 'wrong-secret' },
      });
      expect(response.statusCode).toBe(401);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/overview-access/login',
      remoteAddress: '10.0.0.8',
      payload: { password: 'wrong-secret' },
    });
    expect(blocked.statusCode).toBe(429);
  });

  it('clears the overview cookie on logout', async () => {
    const app = buildApp({ auth: dependencies() });
    const response = await app.inject({ method: 'POST', url: '/api/overview-access/logout' });
    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toContain('Max-Age=0');
  });

  it('bypasses password check and creates a session when overviewAuthDisabled is true', async () => {
    const app = buildApp({ auth: dependencies({ overviewAuthDisabled: true }) });
    const response = await app.inject({
      method: 'POST',
      url: '/api/overview-access/login',
      payload: { password: '' },
    });

    expect(response.statusCode).toBe(204);
    const cookie = response.headers['set-cookie'];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Max-Age=28800');

    // Session should be usable
    const match = /hs_overview=([^\s;]+)/.exec(cookie);
    const sessionRes = await app.inject({
      method: 'GET',
      url: '/api/overview-access/session',
      headers: { cookie: `hs_overview=${match?.[1] ?? ''}` },
    });
    expect(sessionRes.statusCode).toBe(200);
  });

  it('still rejects incorrect password when overviewAuthDisabled is false', async () => {
    const app = buildApp({ auth: dependencies({ overviewAuthDisabled: false }) });
    const response = await app.inject({
      method: 'POST',
      url: '/api/overview-access/login',
      payload: { password: 'wrong-secret' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('employee authorization', () => {
  it('accepts an active reviewer for reviewer routes', async () => {
    const app = buildApp({ auth: dependencies() });
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer reviewer-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.role).toBe('reviewer');
  });

  it('accepts an active admin and marks admin access', async () => {
    const app = buildApp({ auth: dependencies() });
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/admin-check',
      headers: { authorization: 'Bearer admin-token' },
    });
    expect(response.statusCode).toBe(204);
  });

  it('rejects a reviewer from admin-only routes', async () => {
    const app = buildApp({ auth: dependencies() });
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/admin-check',
      headers: { authorization: 'Bearer reviewer-token' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects inactive and invalid users', async () => {
    const app = buildApp({ auth: dependencies() });
    const inactive = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer inactive-token' },
    });
    const invalid = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: 'Bearer invalid-token' },
    });
    expect(inactive.statusCode).toBe(403);
    expect(invalid.statusCode).toBe(401);
  });
});
