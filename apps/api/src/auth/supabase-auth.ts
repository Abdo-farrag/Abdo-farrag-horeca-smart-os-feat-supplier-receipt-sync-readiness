import bcrypt from 'bcryptjs';
import type { AppConfig } from '../config.js';
import type { AppUserRole, AuthDependencies, VerifiedAccessToken } from './types.js';

interface SupabaseUserResponse { id?: string }
interface RoleRow { user_id: string; display_name: string; role: 'reviewer' | 'admin'; is_active: boolean }

async function supabaseRequest(config: AppConfig, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${config.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: config.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

export function createSupabaseAuthDependencies(config: AppConfig): AuthDependencies {
  return {
    overviewPasswordHash: config.OVERVIEW_PASSWORD_HASH,
    sessionSecret: config.SESSION_SECRET,
    overviewAuthDisabled: config.OVERVIEW_AUTH_DISABLED === true,
    verifyOverviewPassword: async (password, passwordHash) => {
      return bcrypt.compare(password, passwordHash);
    },
    verifyAccessToken: async (token): Promise<VerifiedAccessToken | null> => {
      const response = await fetch(`${config.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          apikey: config.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) return null;
      const user = (await response.json()) as SupabaseUserResponse;
      return user.id ? { userId: user.id } : null;
    },
    findUserRole: async (userId): Promise<AppUserRole | null> => {
      const query = new URLSearchParams({
        user_id: `eq.${userId}`,
        select: 'user_id,display_name,role,is_active',
        limit: '1',
      });
      const response = await supabaseRequest(config, `/rest/v1/app_user_roles?${query.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const rows = (await response.json()) as RoleRow[];
      const row = rows[0];
      return row
        ? { userId: row.user_id, displayName: row.display_name, role: row.role, isActive: row.is_active }
        : null;
    },
  };
}
