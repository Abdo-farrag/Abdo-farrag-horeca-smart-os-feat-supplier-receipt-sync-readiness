import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildApp } from '../src/app.js';
import { createOverviewSessionCookie } from '../src/auth/service.js';
import type { AuthDependencies, CompanyPurchaseDependencies } from '../src/auth/types.js';
import { buildPurchaseWorkbook } from '../src/purchase-export.js';
import type { CompanyPurchaseRow } from '@horeca/contracts';

const SESSION_SECRET = '0123456789abcdef0123456789abcdef';

function makeAuth(overrides?: Partial<AuthDependencies>): AuthDependencies {
  return {
    overviewPasswordHash: '$2b$04$72w1q10X84ftozhW1n17Ne.8wGyu2HspLzW0AA3H0s4jQmVrYQYvW',
    sessionSecret: SESSION_SECRET,
    overviewAuthDisabled: false,
    verifyAccessToken: async () => null,
    findUserRole: async () => null,
    ...overrides,
  };
}

function validSessionCookie(): string {
  const header = createOverviewSessionCookie(SESSION_SECRET);
  const match = /hs_overview=([^\s;]+)/.exec(header);
  return `hs_overview=${match?.[1] ?? ''}`;
}

const sampleRows: CompanyPurchaseRow[] = [
  {
    companyId: 1,
    companyName: 'MAS',
    productCode: '101002',
    productName: 'Sample Tea 1',
    priority: 'CRITICAL',
    freeQty: 10,
    effectiveDailyDemand: 5,
    coverageDays: 2,
    targetCoverageDays: 14,
    suggestedQty: 60,
    approvedQty: 60,
    supplierId: 32546,
    supplierName: 'Arma Supplier',
    supplierReadiness: 'VERIFIED_RECEIPT',
    latestReceiptAt: '2026-08-01T10:00:00Z',
    latestUnitCost: 10,
    estimatedValue: 600,
    decisionStatus: 'APPROVED',
    buyerNote: 'Approved MAS note',
    version: 1,
    sourceUpdatedAt: '2026-08-01T10:00:00Z',
    readyForPo: true,
  },
  {
    companyId: 1,
    companyName: 'MAS',
    productCode: '101003',
    productName: 'Sample Coffee MAS',
    priority: 'HIGH',
    freeQty: 0,
    effectiveDailyDemand: 10,
    coverageDays: 0,
    targetCoverageDays: 14,
    suggestedQty: 100,
    approvedQty: null,
    supplierId: null,
    supplierName: null,
    supplierReadiness: 'NEEDS_SUPPLIER',
    latestReceiptAt: null,
    latestUnitCost: null,
    estimatedValue: null,
    decisionStatus: 'NEW',
    buyerNote: null,
    version: 1,
    sourceUpdatedAt: '2026-08-01T10:00:00Z',
    readyForPo: false,
  },
  {
    companyId: 1,
    companyName: 'MAS',
    productCode: '101004',
    productName: 'Sample Milk MAS Approved No Supplier',
    priority: 'MEDIUM',
    freeQty: 5,
    effectiveDailyDemand: 2,
    coverageDays: 2.5,
    targetCoverageDays: 14,
    suggestedQty: 30,
    approvedQty: 30,
    supplierId: null,
    supplierName: null,
    supplierReadiness: 'NEEDS_SUPPLIER',
    latestReceiptAt: null,
    latestUnitCost: 15,
    estimatedValue: 450,
    decisionStatus: 'APPROVED',
    buyerNote: 'Approved without supplier yet',
    version: 1,
    sourceUpdatedAt: '2026-08-01T10:00:00Z',
    readyForPo: false,
  },
  {
    companyId: 1,
    companyName: 'MAS',
    productCode: '101005',
    productName: 'Sample Rejected Item',
    priority: 'LOW',
    freeQty: 50,
    effectiveDailyDemand: 1,
    coverageDays: 50,
    targetCoverageDays: 14,
    suggestedQty: 0,
    approvedQty: null,
    supplierId: 111,
    supplierName: 'Alpha Supplier',
    supplierReadiness: 'FALLBACK_NEEDS_REVIEW',
    latestReceiptAt: '2026-07-15T10:00:00Z',
    latestUnitCost: 5,
    estimatedValue: null,
    decisionStatus: 'REJECTED',
    buyerNote: 'Not needed',
    version: 1,
    sourceUpdatedAt: '2026-08-01T10:00:00Z',
    readyForPo: true,
  },
  {
    companyId: 2,
    companyName: 'Horeca Smart',
    productCode: '101002',
    productName: 'Sample Tea 1',
    priority: 'HIGH',
    freeQty: 5,
    effectiveDailyDemand: 2,
    coverageDays: 2.5,
    targetCoverageDays: 14,
    suggestedQty: 23,
    approvedQty: 25,
    supplierId: 28795,
    supplierName: 'BODUO Supplier',
    supplierReadiness: 'VERIFIED_RECEIPT',
    latestReceiptAt: '2026-08-02T10:00:00Z',
    latestUnitCost: 12,
    estimatedValue: 300,
    decisionStatus: 'APPROVED',
    buyerNote: 'Approved Horeca note',
    version: 1,
    sourceUpdatedAt: '2026-08-02T10:00:00Z',
    readyForPo: true,
  },
];

function makeCompanyPurchaseDeps(
  overrides?: Partial<CompanyPurchaseDependencies>,
): CompanyPurchaseDependencies {
  return {
    list: async () => ({
      data: {
        items: sampleRows,
        pagination: { page: 1, pageSize: 50, total: sampleRows.length, totalPages: 1 },
      },
      error: null,
    }),
    saveDecision: async () => {
      throw new Error('Should not be called during export');
    },
    bulkSave: async () => {
      throw new Error('Should not be called during export');
    },
    exportRows: async (_query) => {
      return sampleRows;
    },
    ...overrides,
  };
}

describe('Pure Workbook Generation (buildPurchaseWorkbook)', () => {
  it('creates a workbook containing exactly MAS and Horeca Smart worksheets', async () => {
    const buffer = await buildPurchaseWorkbook(sampleRows, 'draft', '2026-08-08T12:00:00Z');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheetNames = workbook.worksheets.map((w) => w.name);
    expect(sheetNames).toEqual(['MAS', 'Horeca Smart']);
  });

  it('keeps productCode separate per sheet (company 1 on MAS, company 2 on Horeca Smart)', async () => {
    const buffer = await buildPurchaseWorkbook(sampleRows, 'draft', '2026-08-08T12:00:00Z');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const masSheet = workbook.getWorksheet('MAS')!;
    const horecaSheet = workbook.getWorksheet('Horeca Smart')!;

    const masProductCodes: string[] = [];
    masSheet.eachRow((row, rowNum) => {
      if (rowNum > 1) masProductCodes.push(String(row.getCell(2).value));
    });

    const horecaProductCodes: string[] = [];
    horecaSheet.eachRow((row, rowNum) => {
      if (rowNum > 1) horecaProductCodes.push(String(row.getCell(2).value));
    });

    expect(masProductCodes).toContain('101002');
    expect(masProductCodes).toContain('101003');
    expect(horecaProductCodes).toContain('101002');
    expect(masProductCodes).not.toContain('101005_NONEXISTENT');
  });

  it('draft export includes NEW, APPROVED, REJECTED and NEEDS_SUPPLIER rows for both companies', async () => {
    const buffer = await buildPurchaseWorkbook(sampleRows, 'draft', '2026-08-08T12:00:00Z');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const masSheet = workbook.getWorksheet('MAS')!;
    const horecaSheet = workbook.getWorksheet('Horeca Smart')!;

    // MAS has 4 rows in sampleRows
    expect(masSheet.rowCount).toBe(5); // 1 header + 4 data
    expect(horecaSheet.rowCount).toBe(2); // 1 header + 1 data
  });

  it('approved export includes only APPROVED rows with approvedQty > 0 and marks NEEDS_SUPPLIER as Ready for PO = NO', async () => {
    const buffer = await buildPurchaseWorkbook(sampleRows, 'approved', '2026-08-08T12:00:00Z');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const masSheet = workbook.getWorksheet('MAS')!;
    const horecaSheet = workbook.getWorksheet('Horeca Smart')!;

    // In sampleRows, MAS has 2 approved rows: 101002 (with supplier) and 101004 (no supplier)
    expect(masSheet.rowCount).toBe(3); // 1 header + 2 data rows
    expect(horecaSheet.rowCount).toBe(2); // 1 header + 1 data row

    // Find 101004 in MAS sheet and verify Ready for PO = NO
    let foundNoSupplierRow = false;
    masSheet.eachRow((row, rowNum) => {
      if (rowNum > 1 && String(row.getCell(2).value) === '101004') {
        foundNoSupplierRow = true;
        expect(row.getCell(13).value).toBe('NEEDS_SUPPLIER'); // Supplier Readiness
        expect(row.getCell(19).value).toBe('NO'); // Ready for PO
      }
    });
    expect(foundNoSupplierRow).toBe(true);
  });

  it('handles missing latestUnitCost by leaving Estimated Value cell formula/value blank', async () => {
    const buffer = await buildPurchaseWorkbook(sampleRows, 'draft', '2026-08-08T12:00:00Z');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const masSheet = workbook.getWorksheet('MAS')!;
    masSheet.eachRow((row, rowNum) => {
      if (rowNum > 1 && String(row.getCell(2).value) === '101003') {
        const costCell = row.getCell(15);
        const estValueCell = row.getCell(16);
        expect(costCell.value).toBeNull();
        // Estimated value formula or result should evaluate to blank/null when cost is missing
        if (typeof estValueCell.value === 'object' && estValueCell.value !== null && 'formula' in estValueCell.value) {
          expect(estValueCell.value.formula).toBeDefined();
        } else {
          expect(estValueCell.value).toBeNull();
        }
      }
    });
  });

  it('sorts rows inside each sheet by supplierName ascending (nulls last) then productCode ascending', async () => {
    const buffer = await buildPurchaseWorkbook(sampleRows, 'draft', '2026-08-08T12:00:00Z');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const masSheet = workbook.getWorksheet('MAS')!;
    const productCodesInOrder: string[] = [];
    masSheet.eachRow((row, rowNum) => {
      if (rowNum > 1) {
        productCodesInOrder.push(String(row.getCell(2).value));
      }
    });

    // In sampleRows, MAS items have:
    // 101005: Alpha Supplier
    // 101002: Arma Supplier
    // 101003: null supplier
    // 101004: null supplier
    // Sorted by supplierName asc (nulls last) then productCode asc:
    // 1st: Alpha Supplier (101005)
    // 2nd: Arma Supplier (101002)
    // 3rd: null (101003)
    // 4th: null (101004)
    expect(productCodesInOrder).toEqual(['101005', '101002', '101003', '101004']);
  });

  it('formats workbook header, views, auto-filter, and column cell types correctly', async () => {
    const buffer = await buildPurchaseWorkbook(sampleRows, 'approved', '2026-08-08T12:00:00Z');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const masSheet = workbook.getWorksheet('MAS')!;
    expect(masSheet.views).toBeDefined();
    expect(masSheet.views.some((v) => v.state === 'frozen' && v.ySplit === 1)).toBe(true);
    expect(masSheet.autoFilter).toBeDefined();

    // Row 2 is data
    const dataRow = masSheet.getRow(2);
    // Product code stored as string
    expect(typeof dataRow.getCell(2).value).toBe('string');
    // Quantities stored as numeric
    expect(typeof dataRow.getCell(5).value).toBe('number');
  });

  it('handles datasets with more than 1000 rows correctly', async () => {
    const largeDataset: CompanyPurchaseRow[] = Array.from({ length: 1050 }, (_, i) => ({
      companyId: i % 2 === 0 ? 1 : 2,
      companyName: i % 2 === 0 ? 'MAS' : 'Horeca Smart',
      productCode: `ITEM_${i + 10000}`,
      productName: `Large Item ${i}`,
      priority: 'MEDIUM',
      freeQty: 10,
      effectiveDailyDemand: 1,
      coverageDays: 10,
      targetCoverageDays: 14,
      suggestedQty: 20,
      approvedQty: 20,
      supplierId: 100,
      supplierName: 'Bulk Supplier',
      supplierReadiness: 'VERIFIED_RECEIPT',
      latestReceiptAt: '2026-08-01T10:00:00Z',
      latestUnitCost: 10,
      estimatedValue: 200,
      decisionStatus: 'APPROVED',
      buyerNote: null,
      version: 1,
      sourceUpdatedAt: '2026-08-01T10:00:00Z',
      readyForPo: true,
    }));

    const buffer = await buildPurchaseWorkbook(largeDataset, 'draft', '2026-08-08T12:00:00Z');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const masSheet = workbook.getWorksheet('MAS')!;
    const horecaSheet = workbook.getWorksheet('Horeca Smart')!;

    expect(masSheet.rowCount).toBe(526); // 525 rows + 1 header
    expect(horecaSheet.rowCount).toBe(526); // 525 rows + 1 header
  });
});

describe('GET /api/procurement/company-review/export', () => {
  it('requires overview access when overviewAuthDisabled=false', async () => {
    const app = buildApp({
      auth: makeAuth({ overviewAuthDisabled: false }),
      companyPurchase: makeCompanyPurchaseDeps(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/procurement/company-review/export?scope=draft',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');

    const authorizedRes = await app.inject({
      method: 'GET',
      url: '/api/procurement/company-review/export?scope=draft',
      headers: { cookie: validSessionCookie() },
    });
    expect(authorizedRes.statusCode).toBe(200);
  });

  it('rejects invalid export scope with HTTP 400', async () => {
    const app = buildApp({
      auth: makeAuth({ overviewAuthDisabled: true }),
      companyPurchase: makeCompanyPurchaseDeps(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/procurement/company-review/export?scope=invalid_scope',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns XLSX binary with correct MIME type and Content-Disposition header', async () => {
    const app = buildApp({
      auth: makeAuth({ overviewAuthDisabled: true }),
      companyPurchase: makeCompanyPurchaseDeps(),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/procurement/company-review/export?scope=draft',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toMatch(
      /^attachment;\s*filename="horeca-purchase-plan-draft-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );
    expect(res.rawPayload.length).toBeGreaterThan(100);
  });

  it('calls exportRows dependency and never calls decision/bulk mutations', async () => {
    let exportRowsCalled = false;
    let saveDecisionCalled = false;
    let bulkSaveCalled = false;

    const app = buildApp({
      auth: makeAuth({ overviewAuthDisabled: true }),
      companyPurchase: makeCompanyPurchaseDeps({
        exportRows: async (query) => {
          exportRowsCalled = true;
          expect(query.scope).toBe('approved');
          return sampleRows;
        },
        saveDecision: async () => {
          saveDecisionCalled = true;
          throw new Error('Fail');
        },
        bulkSave: async () => {
          bulkSaveCalled = true;
          throw new Error('Fail');
        },
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/procurement/company-review/export?scope=approved',
    });

    expect(res.statusCode).toBe(200);
    expect(exportRowsCalled).toBe(true);
    expect(saveDecisionCalled).toBe(false);
    expect(bulkSaveCalled).toBe(false);
  });

  it('handles database or export errors by returning a sanitized response', async () => {
    const app = buildApp({
      auth: makeAuth({ overviewAuthDisabled: true }),
      companyPurchase: makeCompanyPurchaseDeps({
        exportRows: async () => {
          throw new Error('Database connection failed secret_token_xyz');
        },
      }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/procurement/company-review/export?scope=draft',
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe('COMPANY_REVIEW_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('secret_token_xyz');
  });
});
