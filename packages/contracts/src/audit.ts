import { z } from 'zod';
import { PaginationSchema, QueryBooleanSchema, queryArraySchema } from './common.js';

export const AuditActionSchema = z.enum([
  'SUPPLIER_APPROVED',
  'SUPPLIER_REJECTED',
  'SUPPLIER_CHANGED',
  'NEEDS_SUPPLIER',
  'UNDO',
  'PRODUCT_RULE_UPDATED',
  'PRODUCT_RULES_BULK_UPDATED',
  'USER_INVITED',
  'USER_ROLE_CHANGED',
  'USER_STATUS_CHANGED',
  'PASSWORD_RESET_REQUESTED',
  'OVERVIEW_LOGIN_SUCCEEDED',
  'OVERVIEW_LOGIN_FAILED',
  'EXPORT_CREATED',
  'RECALCULATION_FAILED',
]);

export const AuditModuleSchema = z.enum([
  'SUPPLIER_REVIEW',
  'PRODUCT_SETTINGS',
  'USERS',
  'AUTH',
  'EXPORT',
  'SYSTEM',
]);

const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format');
const DateFilterSchema = z.union([CalendarDateSchema, z.string().datetime()]);

export const AuditQuerySchema = z.object({
  dateFrom: DateFilterSchema.optional(),
  dateTo: DateFilterSchema.optional(),
  userId: z.string().uuid().optional(),
  actions: queryArraySchema(AuditActionSchema).default([]),
  modules: queryArraySchema(AuditModuleSchema).default([]),
  productCode: z.string().trim().max(120).default(''),
  supplier: z.string().trim().max(200).default(''),
  bulkOnly: QueryBooleanSchema.optional(),
  undoneOnly: QueryBooleanSchema.optional(),
  search: z.string().trim().max(120).default(''),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const AuditEventSchema = z.object({
  id: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  actorUserId: z.string().uuid().nullable(),
  actorDisplayName: z.string().nullable(),
  actorRole: z.enum(['reviewer', 'admin', 'system']).nullable(),
  action: AuditActionSchema,
  module: AuditModuleSchema,
  productCode: z.string().nullable(),
  supplierId: z.number().int().positive().nullable(),
  supplierName: z.string().nullable(),
  oldValue: z.record(z.string(), z.unknown()).nullable(),
  newValue: z.record(z.string(), z.unknown()).nullable(),
  note: z.string().nullable(),
  isBulk: z.boolean(),
  undoneEventId: z.number().int().positive().nullable(),
  requestId: z.string().min(1),
});

export const AuditResponseSchema = z.object({
  data: z.object({
    rows: z.array(AuditEventSchema),
    pagination: PaginationSchema,
  }),
  error: z.null(),
});

export type AuditAction = z.infer<typeof AuditActionSchema>;
export type AuditModule = z.infer<typeof AuditModuleSchema>;
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type AuditResponse = z.infer<typeof AuditResponseSchema>;
