import { z } from 'zod';
import { SupplierStatusSchema } from './common.js';

const DecisionNoteSchema = z.string().trim().max(500).optional();
const SupplierSelectionSchema = z.object({
  supplierId: z.number().int().positive(),
  supplierName: z.string().trim().min(1).max(200),
});

export const SupplierDecisionSchema = z.discriminatedUnion('action', [
  SupplierSelectionSchema.extend({
    action: z.literal('approve'),
    expectedVersion: z.number().int().nonnegative(),
    note: DecisionNoteSchema,
  }),
  SupplierSelectionSchema.extend({
    action: z.literal('change-supplier'),
    expectedVersion: z.number().int().nonnegative(),
    note: DecisionNoteSchema,
  }),
  z.object({
    action: z.literal('reject'),
    expectedVersion: z.number().int().nonnegative(),
    note: DecisionNoteSchema,
  }),
  z.object({
    action: z.literal('needs-supplier'),
    expectedVersion: z.number().int().nonnegative(),
    note: DecisionNoteSchema,
  }),
]);

export const BulkApproveItemSchema = SupplierSelectionSchema.extend({
  productCode: z.string().trim().min(1).max(120),
  expectedVersion: z.number().int().nonnegative(),
});

export const BulkApproveSchema = z
  .object({
    items: z.array(BulkApproveItemSchema).min(1).max(200),
  })
  .superRefine(({ items }, context) => {
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (seen.has(item.productCode)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'productCode'],
          message: 'Duplicate product code',
        });
      }
      seen.add(item.productCode);
    }
  });

export const SupplierHistoryEntrySchema = z.object({
  supplierId: z.number().int().positive(),
  supplierName: z.string().min(1),
  latestReceiptAt: z.string().datetime(),
  receiptsCount: z.number().int().positive(),
  latestReceivedQty: z.number().positive(),
  latestUnitCost: z.number().nonnegative().nullable(),
  companyId: z.union([z.literal(1), z.literal(2)]),
  companyName: z.string().min(1),
});

export const SupplierReviewStateSchema = z.object({
  productCode: z.string().min(1),
  proposedSupplierId: z.number().int().positive().nullable(),
  proposedSupplierName: z.string().min(1).nullable(),
  approvedSupplierId: z.number().int().positive().nullable(),
  approvedSupplierName: z.string().min(1).nullable(),
  status: SupplierStatusSchema,
  version: z.number().int().nonnegative(),
});

export type SupplierDecision = z.infer<typeof SupplierDecisionSchema>;
export type BulkApprove = z.infer<typeof BulkApproveSchema>;
export type SupplierHistoryEntry = z.infer<typeof SupplierHistoryEntrySchema>;
export type SupplierReviewState = z.infer<typeof SupplierReviewStateSchema>;
