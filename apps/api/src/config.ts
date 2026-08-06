import { z } from 'zod';

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
  OVERVIEW_PASSWORD_HASH: z.string().regex(/^\$2[aby]\$\d{2}\$/),
  SESSION_SECRET: z.string().min(32),
  OVERVIEW_AUTH_DISABLED: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean()
  ),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error('INVALID_SERVER_CONFIGURATION');
  }
  return parsed.data;
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/sb_(?:secret|service_role)_[A-Za-z0-9._-]+/g, '[REDACTED]')
      .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, '[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecrets(item)]));
  }
  return value;
}
