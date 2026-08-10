import ExcelJS from 'exceljs';
import type { CompanyPurchaseRow, PurchaseExportScope } from '@horeca/contracts';

const COLUMNS = [
  { header: 'Company', key: 'companyName', width: 16 },
  { header: 'Product Code', key: 'productCode', width: 16 },
  { header: 'Product Name', key: 'productName', width: 32 },
  { header: 'Priority', key: 'priority', width: 12 },
  { header: 'Free Qty', key: 'freeQty', width: 12 },
  { header: 'Daily Demand', key: 'effectiveDailyDemand', width: 14 },
  { header: 'Coverage Days', key: 'coverageDays', width: 14 },
  { header: 'Target Coverage Days', key: 'targetCoverageDays', width: 20 },
  { header: 'Suggested Qty', key: 'suggestedQty', width: 14 },
  { header: 'Approved Qty', key: 'approvedQty', width: 14 },
  { header: 'Supplier ID', key: 'supplierId', width: 14 },
  { header: 'Supplier Name', key: 'supplierName', width: 28 },
  { header: 'Supplier Readiness', key: 'supplierReadiness', width: 22 },
  { header: 'Latest Receipt At', key: 'latestReceiptAt', width: 22 },
  { header: 'Latest Unit Cost', key: 'latestUnitCost', width: 16 },
  { header: 'Estimated Value', key: 'estimatedValue', width: 16 },
  { header: 'Decision Status', key: 'decisionStatus', width: 16 },
  { header: 'Buyer Note', key: 'buyerNote', width: 30 },
  { header: 'Ready for PO', key: 'readyForPo', width: 14 },
  { header: 'Source Updated At', key: 'sourceUpdatedAt', width: 22 },
  { header: 'Export Type', key: 'exportType', width: 14 },
  { header: 'Generated At', key: 'generatedAt', width: 22 },
];

function sortRows(rows: CompanyPurchaseRow[]): CompanyPurchaseRow[] {
  return [...rows].sort((a, b) => {
    if (!a.supplierName && !b.supplierName) {
      return a.productCode.localeCompare(b.productCode);
    }
    if (!a.supplierName) return 1;
    if (!b.supplierName) return -1;
    const cmp = a.supplierName.localeCompare(b.supplierName);
    if (cmp !== 0) return cmp;
    return a.productCode.localeCompare(b.productCode);
  });
}

export async function buildPurchaseWorkbook(
  rows: CompanyPurchaseRow[],
  scope: PurchaseExportScope,
  generatedAt: string = new Date().toISOString(),
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;

  const companyConfigs = [
    { name: 'MAS', companyId: 1 },
    { name: 'Horeca Smart', companyId: 2 },
  ];

  for (const config of companyConfigs) {
    const sheet = workbook.addWorksheet(config.name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = COLUMNS;

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F497D' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: COLUMNS.length },
    };

    const companyRows = rows.filter((r) => r.companyId === config.companyId);
    const scopedRows =
      scope === 'approved'
        ? companyRows.filter(
            (r) =>
              r.decisionStatus === 'APPROVED' &&
              r.approvedQty !== null &&
              r.approvedQty > 0,
          )
        : companyRows;

    const sortedRows = sortRows(scopedRows);

    let rowIdx = 2;
    for (const r of sortedRows) {
      const row = sheet.getRow(rowIdx);

      const suggestedQtyVal = r.suggestedQty ?? null;
      const approvedQtyVal = r.approvedQty ?? null;
      const latestUnitCostVal = r.latestUnitCost ?? null;

      row.getCell(1).value = r.companyName;
      row.getCell(2).value = String(r.productCode);
      row.getCell(2).numFmt = '@';
      row.getCell(3).value = r.productName;
      row.getCell(4).value = r.priority;

      row.getCell(5).value = r.freeQty;
      row.getCell(5).numFmt = '#,##0.00';

      row.getCell(6).value = r.effectiveDailyDemand;
      row.getCell(6).numFmt = '#,##0.00';

      row.getCell(7).value = r.coverageDays;
      if (r.coverageDays !== null) row.getCell(7).numFmt = '#,##0.00';

      row.getCell(8).value = r.targetCoverageDays;
      row.getCell(8).numFmt = '#,##0.00';

      row.getCell(9).value = suggestedQtyVal;
      if (suggestedQtyVal !== null) row.getCell(9).numFmt = '#,##0.00';

      row.getCell(10).value = approvedQtyVal;
      if (approvedQtyVal !== null) row.getCell(10).numFmt = '#,##0.00';

      row.getCell(11).value = r.supplierId;
      row.getCell(12).value = r.supplierName;
      row.getCell(13).value = r.supplierReadiness;
      row.getCell(14).value = r.latestReceiptAt;

      row.getCell(15).value = latestUnitCostVal;
      if (latestUnitCostVal !== null) row.getCell(15).numFmt = '#,##0.00';

      // Cell 16: Estimated Value Formula
      // Formula evaluates to blank string if cost or quantity is null
      const R = rowIdx;
      row.getCell(16).value = {
        formula: `IF(AND(OR(ISNUMBER(J${R}),ISNUMBER(I${R})),ISNUMBER(O${R})),IF(ISNUMBER(J${R}),J${R},I${R})*O${R},"")`,
      };
      row.getCell(16).numFmt = '#,##0.00';

      row.getCell(17).value = r.decisionStatus;
      row.getCell(18).value = r.buyerNote;
      row.getCell(19).value = r.readyForPo ? 'YES' : 'NO';
      row.getCell(20).value = r.sourceUpdatedAt;
      row.getCell(21).value = scope;
      row.getCell(22).value = generatedAt;

      rowIdx++;
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
