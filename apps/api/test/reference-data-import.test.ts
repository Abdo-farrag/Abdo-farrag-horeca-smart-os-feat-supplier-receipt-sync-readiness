import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AuthDependencies } from '../src/auth/types.js';

function makeAuth(authenticated = true): AuthDependencies {
  return {
    overviewPasswordHash: '$2b$04$72w1q10X84ftozhW1n17Ne.8wGyu2HspLzW0AA3H0s4jQmVrYQYvW',
    sessionSecret: '0123456789abcdef0123456789abcdef',
    overviewAuthDisabled: authenticated,
    verifyAccessToken: async () => null,
    findUserRole: async () => null,
  };
}

function makeReferenceDataDependencies() {
  return {
    exportWorkbook: async () => Buffer.from('xlsx-workbook'),
    previewImport: async () => ({
      batchId: '11111111-1111-4111-8111-111111111111',
      filename: 'procurement-reference.xlsx',
      templateVersion: '1.0',
      totalRows: 2,
      validRows: 2,
      invalidRows: 0,
      errors: [],
      changes: [
        {
          rowNumber: 2,
          companyId: 1,
          productCode: '101071',
          supplierId: 29906,
          changeType: 'UPDATE',
        },
      ],
    }),
    applyImport: async () => ({
      batchId: '11111111-1111-4111-8111-111111111111',
      status: 'APPLIED',
      inserted: 1,
      updated: 1,
      unchanged: 0,
      skipped: 0,
    }),
  };
}

describe('procurement reference-data bulk import API', () => {
  it('requires dashboard authentication for reference export', async () => {
    const app = buildApp({
      auth: makeAuth(false),
      referenceData: makeReferenceDataDependencies(),
    } as never);

    const response = await app.inject({
      method: 'GET',
      url: '/api/procurement/reference-data/export',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('exports the editable reference workbook without writing data', async () => {
    const app = buildApp({
      auth: makeAuth(),
      referenceData: makeReferenceDataDependencies(),
    } as never);

    const response = await app.inject({
      method: 'GET',
      url: '/api/procurement/reference-data/export',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(response.headers['content-disposition']).toContain('.xlsx');
  });

  it('previews a base64 workbook and returns row-level validation without applying it', async () => {
    const app = buildApp({
      auth: makeAuth(),
      referenceData: makeReferenceDataDependencies(),
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/procurement/reference-data/preview',
      payload: {
        filename: 'procurement-reference.xlsx',
        contentBase64: Buffer.from('workbook').toString('base64'),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      batchId: '11111111-1111-4111-8111-111111111111',
      validRows: 2,
      invalidRows: 0,
    });
  });

  it('applies only a previously previewed batch id', async () => {
    const app = buildApp({
      auth: makeAuth(),
      referenceData: makeReferenceDataDependencies(),
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/api/procurement/reference-data/apply',
      payload: { batchId: '11111111-1111-4111-8111-111111111111' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      status: 'APPLIED',
      inserted: 1,
      updated: 1,
    });
  });

  it('rejects malformed preview and apply payloads before calling dependencies', async () => {
    const app = buildApp({
      auth: makeAuth(),
      referenceData: makeReferenceDataDependencies(),
    } as never);

    const preview = await app.inject({
      method: 'POST',
      url: '/api/procurement/reference-data/preview',
      payload: { filename: 'reference.csv', contentBase64: 'not-base64!' },
    });
    const apply = await app.inject({
      method: 'POST',
      url: '/api/procurement/reference-data/apply',
      payload: { batchId: 'not-a-uuid', rows: [{ productCode: 'tampered' }] },
    });

    expect(preview.statusCode).toBe(400);
    expect(preview.json().error.code).toBe('VALIDATION_ERROR');
    expect(apply.statusCode).toBe(400);
    expect(apply.json().error.code).toBe('VALIDATION_ERROR');
  });
});
