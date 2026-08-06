import { z } from 'zod';

export const CompanyFilterSchema = z.union([
  z.literal('all'),
  z.literal('1'),
  z.literal('2'),
]);

export const CoverageDaysSchema = z.union([
  z.literal(7),
  z.literal(14),
  z.literal(21),
  z.literal(30),
]);

export const PrioritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

export const SupplierStatusSchema = z.enum([
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'NEEDS_SUPPLIER',
]);

export const DataStatusSchema = z.enum(['SUFFICIENT', 'INSUFFICIENT']);

export const QueryBooleanSchema = z.preprocess((value) => {
  if (value === undefined || typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
}, z.boolean());

export function queryArraySchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === '') return [];
    return Array.isArray(value) ? value : [value];
  }, z.array(itemSchema));
}

export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const PaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(200),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export type CompanyFilter = z.infer<typeof CompanyFilterSchema>;
export type CoverageDays = z.infer<typeof CoverageDaysSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type SupplierStatus = z.infer<typeof SupplierStatusSchema>;
export type DataStatus = z.infer<typeof DataStatusSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
