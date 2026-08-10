import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuthDependencies, CompanyPurchaseDependencies } from '../src/auth/types.js';

function makeAuth(): AuthDependencies {
  return {
    overviewPasswordHash: '',
    sessionSecret: '0123456789abcdef0123456789abcdef',
    overviewAuthDisabled: true,
    verifyAccessToken: async () => null,
    findUserRole: async () => null,
  };
}

function makeCompanyPurchase(): CompanyPurchaseDependencies {
  return {
    list: async () => {
      throw new Error('Supabase company purchase view error 500: Relation does not exist');
    },
    saveDecision: async () => {
      throw new Error('Not implemented');
    },
    bulkSave: async () => {
      throw new Error('Not implemented');
    },
    exportRows: async () => [],
  };
}

describe('SPA Routing and API Boundaries', () => {
  it('GET /api/procurement/company-review never returns HTML even on error', async () => {
    const app = buildApp({ auth: makeAuth(), companyPurchase: makeCompanyPurchase() });
    const res = await app.inject({
      method: 'GET',
      url: '/api/procurement/company-review?company=all&page=1&pageSize=1',
    });

    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-type']).not.toContain('text/html');
    expect(res.body).not.toContain('<!doctype html>');
  });

  it('any request path containing /api/ returns a JSON 404 response, never index.html', async () => {
    const app = buildApp({ auth: makeAuth(), companyPurchase: makeCompanyPurchase() });

    const res1 = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res1.headers['content-type']).toContain('application/json');
    expect(res1.json().error.code).toBe('NOT_FOUND');

    const res2 = await app.inject({ method: 'GET', url: '/procurement/api/procurement/company-review' });
    expect(res2.headers['content-type']).toContain('application/json');
    expect(res2.json().error.code).toBe('NOT_FOUND');
    expect(res2.body).not.toContain('<!doctype html>');
  });

  it('/procurement/review returns the SPA index.html', async () => {
    const app = buildApp({ auth: makeAuth(), companyPurchase: makeCompanyPurchase() });
    const res = await app.inject({ method: 'GET', url: '/procurement/review' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<!doctype html>');
  });
});
