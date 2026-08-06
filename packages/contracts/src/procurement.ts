import { z } from 'zod';
import {
  CompanyFilterSchema,
  CoverageDaysSchema,
  DataStatusSchema,
  PaginationSchema,
  PrioritySchema,
  QueryBooleanSchema,
  SupplierStatusSchema,
  queryArraySchema,
} from './common.js';

export const OverviewQuerySchema = z.object({
  company: CompanyFilterSchema.default('all'),
  coverageDays: z.coerce.number().pipe(CoverageDaysSchema).default(14),
  priorities: queryArraySchema(PrioritySchema).default([]),
  supplierStatuses: queryArraySchema(SupplierStatusSchema).default([]),
  needsPurchase: QueryBooleanSchema.optional(),
  noSupplier: QueryBooleanSchema.optional(),
  insufficientData: QueryBooleanSchema.optional(),
  search: z.string().trim().max(120).default(''),
  sort: z
    .enum(['priority', 'suggestedQty', 'coverageDays', 'productName', 'latestReceipt'])
    .default('priority'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const ProcurementRowSchema = z.object({
  productCode: z.string().min(1),
  productName: z.string().min(1),
  freeQty: z.number(),
  effectiveDailyDemand: z.number().nonnegative(),
  forecastQty: z.number().nonnegative().nullable(),
  leadTimeQty: z.number().nonnegative().nullable(),
  safetyStockQty: z.number().nonnegative().nullable(),
  actualCoverageDays: z.number().nonnegative().nullable(),
  leadTimeDays: z.number().int().min(0).max(90),
  safetyStockDays: z.number().int().min(0).max(60),
  suggestedQty: z.number().nonnegative().nullable(),
  priority: PrioritySchema,
  dataStatus: DataStatusSchema,
  proposedSupplierId: z.number().int().positive().nullable(),
  proposedSupplierName: z.string().min(1).nullable(),
  approvedSupplierId: z.number().int().positive().nullable(),
  approvedSupplierName: z.string().min(1).nullable(),
  supplierStatus: SupplierStatusSchema,
  latestReceiptAt: z.string().datetime().nullable(),
  version: z.number().int().nonnegative(),
});

export const ProcurementOverviewSummarySchema = z.object({
  needsPurchase: z.number().int().nonnegative(),
  critical: z.number().int().nonnegative(),
  totalSuggestedQty: z.number().nonnegative(),
  noSupplier: z.number().int().nonnegative(),
  insufficientData: z.number().int().nonnegative(),
});

export const ProcurementOverviewResponseSchema = z.object({
  data: z.object({
    rows: z.array(ProcurementRowSchema),
    summary: ProcurementOverviewSummarySchema,
    pagination: PaginationSchema,
  }),
  error: z.null(),
});

export type OverviewQuery = z.infer<typeof OverviewQuerySchema>;
export type ProcurementRow = z.infer<typeof ProcurementRowSchema>;
export type ProcurementOverviewSummary = z.infer<
  typeof ProcurementOverviewSummarySchema
>;
export type ProcurementOverviewResponse = z.infer<
  typeof ProcurementOverviewResponseSchema
>;
