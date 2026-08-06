import { z } from 'zod';

export const UserRoleSchema = z.enum(['reviewer', 'admin']);
export const UserStatusSchema = z.enum(['active', 'disabled']);

export const UserInviteSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  displayName: z.string().trim().min(2).max(120),
  role: UserRoleSchema,
});

export const UserRoleUpdateSchema = z.object({
  role: UserRoleSchema,
  expectedVersion: z.number().int().nonnegative(),
});

export const UserStatusUpdateSchema = z.object({
  isActive: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
});

export const UserRowSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1),
  role: UserRoleSchema,
  status: UserStatusSchema,
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  lastSignInAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  updatedBy: z.string().uuid().nullable(),
});

export const UserListQuerySchema = z.object({
  role: UserRoleSchema.optional(),
  status: UserStatusSchema.optional(),
  search: z.string().trim().max(120).default(''),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type UserRole = z.infer<typeof UserRoleSchema>;
export type UserStatus = z.infer<typeof UserStatusSchema>;
export type UserInvite = z.infer<typeof UserInviteSchema>;
export type UserRoleUpdate = z.infer<typeof UserRoleUpdateSchema>;
export type UserStatusUpdate = z.infer<typeof UserStatusUpdateSchema>;
export type UserRow = z.infer<typeof UserRowSchema>;
export type UserListQuery = z.infer<typeof UserListQuerySchema>;
