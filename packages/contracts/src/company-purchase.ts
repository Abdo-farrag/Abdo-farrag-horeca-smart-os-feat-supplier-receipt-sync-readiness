import { z } from 'zod';
import { PrioritySchema } from './common.js';

export const CompanyIdSchema = z.union([z.literal(1), z.literal(2)]);

export const PurchaseDecisionStatusSchema = z.enum([
  'NEW',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'DEFERRED',
]);

export const SupplierReadinessSchema = z.enum([
  'VERIFIED_RECEIPT',
  'FALLBACK_NEEDS_REVIEW',
  'NEEDS_SUPPLIER',
]);

export const PurchaseExportScopeSchema = z.enum(['draft', 'approved']);

export const CompanyPurchaseDecisionInputSchema = z
  .object({
    companyId: CompanyIdSchema,
    productCode: z.string().trim().min(1),
    decisionStatus: PurchaseDecisionStatusSchema,
    approvedQty: z.number().min(0).optional().nullable(),
    approvedSupplierId: z.number().int().positive().optional().nullable(),
    approvedSupplierName: z.string().optional().nullable(),
    buyerNote: z.string().max(1000).optional().nullable(),
    expectedVersion: z.number().int().min(0),
  })
  .superRefine((data, ctx) => {
    if (data.decisionStatus === 'APPROVED') {
      if (
        data.approvedQty === undefined ||
        data.approvedQty === null ||
        data.approvedQty <= 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'APPROVED status requires approvedQty > 0',
          path: ['approvedQty'],
        });
      }
    }
  });

export const CompanyPurchaseRowSchema = z.object({
  companyId: CompanyIdSchema,
  companyName: z.string().min(1),
  productCode: z.string().min(1),
  productName: z.string().min(1),
  priority: PrioritySchema,
  freeQty: z.number(),
  effectiveDailyDemand: z.number().nonnegative(),
  coverageDays: z.number().nonnegative().nullable(),
  targetCoverageDays: z.number().nonnegative(),
  suggestedQty: z.number().nonnegative().nullable(),
  approvedQty: z.number().nonnegative().nullable(),
  supplierId: z.number().int().positive().nullable(),
  supplierName: z.string().nullable(),
  supplierReadiness: SupplierReadinessSchema,
  latestReceiptAt: z.string().datetime().nullable(),
  latestUnitCost: z.number().nonnegative().nullable(),
  estimatedValue: z.number().nonnegative().nullable(),
  decisionStatus: PurchaseDecisionStatusSchema,
  buyerNote: z.string().max(1000).nullable(),
  version: z.number().int().min(0),
  sourceUpdatedAt: z.string().nullable(),
  readyForPo: z.boolean(),
});

export const CompanyPurchaseExportQuerySchema = z.object({
  companyId: z.coerce.number().pipe(CompanyIdSchema).optional(),
  scope: PurchaseExportScopeSchema.default('approved'),
});

export type CompanyId = z.infer<typeof CompanyIdSchema>;
export type PurchaseDecisionStatus = z.infer<typeof PurchaseDecisionStatusSchema>;
export type SupplierReadiness = z.infer<typeof SupplierReadinessSchema>;
export type PurchaseExportScope = z.infer<typeof PurchaseExportScopeSchema>;
export type CompanyPurchaseDecisionInput = z.infer<
  typeof CompanyPurchaseDecisionInputSchema
>;
export type CompanyPurchaseRow = z.infer<typeof CompanyPurchaseRowSchema>;
export type CompanyPurchaseExportQuery = z.infer<
  typeof CompanyPurchaseExportQuerySchema
>;
