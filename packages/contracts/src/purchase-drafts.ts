import { z } from 'zod';
import { CompanyIdSchema } from './company-purchase.js';

export const PurchaseDraftStatusSchema = z.enum([
  'DRAFT',
  'READY_FOR_EXPORT',
  'EXPORTED',
  'CLOSED',
  'CANCELLED',
]);

export const PurchasePriceSourceSchema = z.enum([
  'REFERENCE_OVERRIDE',
  'ODOO_VENDOR_PRICE',
  'SAME_SUPPLIER_RECEIPT',
  'OTHER_SUPPLIER_REFERENCE',
  'MISSING',
  'MANUAL_CONFIRMED',
]);

export const PurchaseDraftWarningSchema = z.enum([
  'PACKAGING_REVIEW_REQUIRED',
  'MISSING_PRICE',
  'OTHER_SUPPLIER_PRICE',
  'BRAND_UNDEFINED',
]);

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD date');

export const SupplierDirectoryQuerySchema = z.object({
  search: z.string().trim().max(120).default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const SupplierDirectoryItemSchema = z.object({
  supplierId: z.number().int().positive(),
  supplierName: z.string().trim().min(1).max(300),
  supplierCode: z.string().trim().max(120).nullable(),
  supplierRank: z.number().int().positive(),
  active: z.literal(true),
  sourceUpdatedAt: z.string().datetime().nullable(),
});

const PurchaseDraftSelectionSchema = z.object({
  productCode: z.string().trim().min(1).max(120),
  expectedRecommendationVersion: z.number().int().min(0),
});

export const PurchaseDraftCreateInputSchema = z
  .object({
    companyId: CompanyIdSchema,
    supplierId: z.number().int().positive(),
    expectedReceiptDate: IsoDateSchema.optional().nullable(),
    buyerNote: z.string().trim().max(1000).optional().nullable(),
    items: z.array(PurchaseDraftSelectionSchema).min(1).max(200),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.items.forEach((item, index) => {
      if (seen.has(item.productCode)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'productCode'],
          message: `Duplicate productCode: ${item.productCode}`,
        });
      }
      seen.add(item.productCode);
    });
  });

export const PurchaseDraftLineInputSchema = z.object({
  approvedQty: z.number().finite().positive(),
  unitPrice: z.number().finite().nonnegative().optional().nullable(),
  buyerNote: z.string().trim().max(1000).optional().nullable(),
  expectedVersion: z.number().int().min(0),
});

export const PurchaseDraftStatusInputSchema = z.object({
  status: PurchaseDraftStatusSchema,
  expectedVersion: z.number().int().min(0),
});

export const PurchaseDraftRfqReferenceInputSchema = z.object({
  odooRfqId: z.number().int().positive().optional().nullable(),
  odooRfqName: z.string().trim().min(1).max(120),
  expectedVersion: z.number().int().min(0),
});

export const PurchaseDraftSchema = z.object({
  id: z.string().uuid(),
  status: PurchaseDraftStatusSchema,
  companyId: CompanyIdSchema,
  companyName: z.string().min(1),
  supplierId: z.number().int().positive(),
  supplierName: z.string().min(1),
  supplierCode: z.string().nullable(),
  expectedReceiptDate: IsoDateSchema.nullable(),
  buyerNote: z.string().max(1000).nullable(),
  odooRfqId: z.number().int().positive().nullable(),
  odooRfqName: z.string().nullable(),
  version: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const PurchaseDraftLineSchema = z.object({
  id: z.string().uuid(),
  draftId: z.string().uuid(),
  productCode: z.string().min(1),
  productName: z.string().min(1),
  brandName: z.string().nullable(),
  suggestedQty: z.number().nonnegative(),
  approvedQty: z.number().positive(),
  purchaseUom: z.string().nullable(),
  minimumOrderQty: z.number().positive().nullable(),
  orderMultiple: z.number().positive().nullable(),
  unitPrice: z.number().nonnegative().nullable(),
  priceSource: PurchasePriceSourceSchema,
  currency: z.string().nullable(),
  warnings: z.array(PurchaseDraftWarningSchema),
  sourceRecommendationVersion: z.number().int().min(0),
  version: z.number().int().min(0),
  buyerNote: z.string().max(1000).nullable(),
});

export type PurchaseDraftStatus = z.infer<typeof PurchaseDraftStatusSchema>;
export type PurchasePriceSource = z.infer<typeof PurchasePriceSourceSchema>;
export type PurchaseDraftWarning = z.infer<typeof PurchaseDraftWarningSchema>;
export type SupplierDirectoryQuery = z.infer<typeof SupplierDirectoryQuerySchema>;
export type SupplierDirectoryItem = z.infer<typeof SupplierDirectoryItemSchema>;
export type PurchaseDraftCreateInput = z.infer<typeof PurchaseDraftCreateInputSchema>;
export type PurchaseDraftLineInput = z.infer<typeof PurchaseDraftLineInputSchema>;
export type PurchaseDraftStatusInput = z.infer<typeof PurchaseDraftStatusInputSchema>;
export type PurchaseDraftRfqReferenceInput = z.infer<
  typeof PurchaseDraftRfqReferenceInputSchema
>;
export type PurchaseDraft = z.infer<typeof PurchaseDraftSchema>;
export type PurchaseDraftLine = z.infer<typeof PurchaseDraftLineSchema>;

const ALLOWED_TRANSITIONS: Record<PurchaseDraftStatus, ReadonlySet<PurchaseDraftStatus>> = {
  DRAFT: new Set(['READY_FOR_EXPORT', 'CANCELLED']),
  READY_FOR_EXPORT: new Set(['EXPORTED', 'CANCELLED']),
  EXPORTED: new Set(['CLOSED']),
  CLOSED: new Set(),
  CANCELLED: new Set(),
};

export function canTransitionPurchaseDraft(
  current: PurchaseDraftStatus,
  next: PurchaseDraftStatus,
): boolean {
  return ALLOWED_TRANSITIONS[current].has(next);
}

export function roundPurchaseQuantity(
  suggestedQty: number,
  minimumOrderQty: number | null,
  orderMultiple: number | null,
): { quantity: number; warnings: PurchaseDraftWarning[] } {
  if (!Number.isFinite(suggestedQty) || suggestedQty < 0) {
    throw new Error('INVALID_SUGGESTED_QUANTITY');
  }
  if (minimumOrderQty !== null && (!Number.isFinite(minimumOrderQty) || minimumOrderQty <= 0)) {
    throw new Error('INVALID_MINIMUM_ORDER_QUANTITY');
  }
  if (orderMultiple !== null && (!Number.isFinite(orderMultiple) || orderMultiple <= 0)) {
    throw new Error('INVALID_ORDER_MULTIPLE');
  }

  if (minimumOrderQty === null && orderMultiple === null) {
    return { quantity: suggestedQty, warnings: ['PACKAGING_REVIEW_REQUIRED'] };
  }

  const minimumApplied = Math.max(suggestedQty, minimumOrderQty ?? 0);
  const quantity = orderMultiple === null
    ? minimumApplied
    : Math.ceil(minimumApplied / orderMultiple) * orderMultiple;

  return { quantity, warnings: [] };
}
