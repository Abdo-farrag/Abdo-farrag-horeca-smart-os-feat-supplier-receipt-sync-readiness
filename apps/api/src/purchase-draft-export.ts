import ExcelJS from 'exceljs';
import type { PurchaseDraft, PurchaseDraftLine } from '@horeca/contracts';

const HEADER_FILL = '1F497D';
const WARNING_LABELS: Record<string, string> = {
  PACKAGING_REVIEW_REQUIRED: 'راجع عبوة الشراء أو الحد الأدنى يدويًا في Odoo',
  MISSING_PRICE: 'سعر المورد غير متاح ويجب تأكيده يدويًا',
  OTHER_SUPPLIER_PRICE: 'السعر استرشادي من مورد آخر',
  BRAND_UNDEFINED: 'البراند الرسمي غير محدد في Odoo',
};

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${HEADER_FILL}` } };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
}

export async function buildPurchaseDraftRfqWorkbook(
  draft: PurchaseDraft,
  lines: PurchaseDraftLine[],
  generatedAt: string,
): Promise<Buffer> {
  if (draft.status !== 'READY_FOR_EXPORT' && draft.status !== 'EXPORTED') {
    throw new Error('DRAFT_NOT_READY_FOR_EXPORT');
  }
  if (lines.length === 0) throw new Error('EMPTY_PURCHASE_DRAFT');
  if (lines.some((line) => line.draftId !== draft.id)) {
    throw new Error('MIXED_PURCHASE_DRAFT_LINES');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Horeca Smart OS';
  workbook.created = new Date(generatedAt);

  const rfq = workbook.addWorksheet('RFQ', {
    views: [{ state: 'frozen', ySplit: 8, rightToLeft: true }],
  });
  rfq.mergeCells('A1:H1');
  rfq.getCell('A1').value = 'مسودة طلب عرض سعر — إدخال يدوي إلى Odoo';
  rfq.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  rfq.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${HEADER_FILL}` },
  };
  rfq.getCell('A2').value = 'Company / الشركة';
  rfq.getCell('B2').value = draft.companyName;
  rfq.getCell('A3').value = 'Supplier / المورد';
  rfq.getCell('B3').value = draft.supplierName;
  rfq.getCell('A4').value = 'Supplier Code / كود المورد';
  rfq.getCell('B4').value = draft.supplierCode ?? '';
  rfq.getCell('A5').value = 'Expected Receipt / الاستلام المتوقع';
  rfq.getCell('B5').value = draft.expectedReceiptDate ?? '';
  rfq.getCell('A6').value = 'Generated At / تاريخ التصدير';
  rfq.getCell('B6').value = generatedAt;
  rfq.getCell('D2').value = 'Draft ID';
  rfq.getCell('E2').value = draft.id;
  rfq.getCell('D3').value = 'Buyer Note / ملاحظة';
  rfq.getCell('E3').value = draft.buyerNote ?? '';

  const header = rfq.getRow(8);
  header.values = [
    'Product Code',
    'Product Name',
    'Brand',
    'Approved Qty',
    'Purchase UoM',
    'Unit Price',
    'Currency',
    'Estimated Total',
  ];
  styleHeader(header);

  lines.forEach((line, index) => {
    const rowNumber = index + 9;
    const row = rfq.getRow(rowNumber);
    row.values = [
      line.productCode,
      line.productName,
      line.brandName ?? 'براند غير محدد',
      line.approvedQty,
      line.purchaseUom ?? '',
      line.unitPrice,
      line.currency ?? '',
      line.unitPrice === null ? '' : { formula: `D${rowNumber}*F${rowNumber}` },
    ];
    row.getCell(1).numFmt = '@';
    row.getCell(4).numFmt = '#,##0.00';
    row.getCell(6).numFmt = '#,##0.00';
    row.getCell(8).numFmt = '#,##0.00';
  });

  rfq.columns = [
    { width: 18 },
    { width: 42 },
    { width: 24 },
    { width: 16 },
    { width: 18 },
    { width: 16 },
    { width: 12 },
    { width: 20 },
  ];
  rfq.autoFilter = { from: 'A8', to: `H${Math.max(8, lines.length + 8)}` };

  const warnings = workbook.addWorksheet('Warnings', {
    views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }],
  });
  const warningHeader = warnings.getRow(1);
  warningHeader.values = ['Product Code', 'Warning Code', 'Arabic Guidance', 'Price Source'];
  styleHeader(warningHeader);
  let warningRow = 2;
  for (const line of lines) {
    for (const warning of line.warnings) {
      warnings.addRow([
        line.productCode,
        warning,
        WARNING_LABELS[warning] ?? warning,
        line.priceSource,
      ]);
      warnings.getCell(`A${warningRow}`).numFmt = '@';
      warningRow += 1;
    }
  }
  warnings.columns = [{ width: 18 }, { width: 34 }, { width: 52 }, { width: 28 }];
  warnings.autoFilter = { from: 'A1', to: `D${Math.max(1, warningRow - 1)}` };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
