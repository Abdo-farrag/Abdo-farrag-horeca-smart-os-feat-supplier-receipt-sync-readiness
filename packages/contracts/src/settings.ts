import { z } from 'zod';

export const LeadTimeDaysSchema = z.number().int().min(0).max(90);
export const SafetyStockDaysSchema = z.number().int().min(0).max(60);

export const ProductRuleUpdateSchema = z.object({
  leadTimeDays: LeadTimeDaysSchema,
  safetyStockDays: SafetyStockDaysSchema,
  expectedVersion: z.number().int().nonnegative(),
  note: z.string().trim().max(500).optional(),
});

export const ProductRulePatchSchema = z
  .object({
    leadTimeDays: LeadTimeDaysSchema.optional(),
    safetyStockDays: SafetyStockDaysSchema.optional(),
    expectedVersion: z.number().int().nonnegative(),
    note: z.string().trim().max(500).optional(),
  })
  .refine(
    ({ leadTimeDays, safetyStockDays }) =>
      leadTimeDays !== undefined || safetyStockDays !== undefined,
    { message: 'At least one product rule value is required' },
  );

export const BulkProductRuleUpdateSchema = z.object({
  items: z
    .array(
      z.object({
        productCode: z.string().trim().min(1).max(120),
        expectedVersion: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(200),
  changes: z
    .object({
      leadTimeDays: LeadTimeDaysSchema.optional(),
      safetyStockDays: SafetyStockDaysSchema.optional(),
    })
    .refine(
      ({ leadTimeDays, safetyStockDays }) =>
        leadTimeDays !== undefined || safetyStockDays !== undefined,
      { message: 'At least one product rule value is required' },
    ),
  note: z.string().trim().max(500).optional(),
});

export const ProductRuleSchema = z.object({
  productCode: z.string().min(1),
  productName: z.string().min(1),
  leadTimeDays: LeadTimeDaysSchema,
  safetyStockDays: SafetyStockDaysSchema,
  isDefault: z.boolean(),
  version: z.number().int().nonnegative(),
  updatedAt: z.string().datetime().nullable(),
  updatedBy: z.string().uuid().nullable(),
});

export type ProductRuleUpdate = z.infer<typeof ProductRuleUpdateSchema>;
export type ProductRulePatch = z.infer<typeof ProductRulePatchSchema>;
export type BulkProductRuleUpdate = z.infer<typeof BulkProductRuleUpdateSchema>;
export type ProductRule = z.infer<typeof ProductRuleSchema>;
