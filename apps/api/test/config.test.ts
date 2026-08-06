import { describe, expect, it } from 'vitest';
import { loadConfig, redactSecrets } from '../src/config.js';

describe('backend configuration', () => {
  const valid = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abcdefghijklmnopqrstuvwxyz0123456789',
    OVERVIEW_PASSWORD_HASH: '$2b$12$01234567890123456789012345678901234567890123456789012',
    SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  };

  it('loads server-only environment values', () => {
    const config = loadConfig(valid);
    expect(config.PORT).toBe(3000);
    expect(config.SUPABASE_URL).toBe(valid.SUPABASE_URL);
  });

  it('parses OVERVIEW_AUTH_DISABLED correctly', () => {
    // missing variable => false
    expect(loadConfig(valid).OVERVIEW_AUTH_DISABLED).toBe(false);

    // "false" => false
    expect(loadConfig({ ...valid, OVERVIEW_AUTH_DISABLED: 'false' }).OVERVIEW_AUTH_DISABLED).toBe(false);

    // "true" => true
    expect(loadConfig({ ...valid, OVERVIEW_AUTH_DISABLED: 'true' }).OVERVIEW_AUTH_DISABLED).toBe(true);

    // any other value => false
    expect(loadConfig({ ...valid, OVERVIEW_AUTH_DISABLED: '1' }).OVERVIEW_AUTH_DISABLED).toBe(false);
    expect(loadConfig({ ...valid, OVERVIEW_AUTH_DISABLED: 'TRUE' }).OVERVIEW_AUTH_DISABLED).toBe(false);
    expect(loadConfig({ ...valid, OVERVIEW_AUTH_DISABLED: 'yes' }).OVERVIEW_AUTH_DISABLED).toBe(false);
    expect(loadConfig({ ...valid, OVERVIEW_AUTH_DISABLED: 'invalid' }).OVERVIEW_AUTH_DISABLED).toBe(false);
  });

  it('returns one safe error for invalid or missing secrets', () => {
    expect(() => loadConfig({})).toThrow('INVALID_SERVER_CONFIGURATION');
    try {
      loadConfig({ ...valid, SESSION_SECRET: 'short' });
    } catch (error) {
      expect(String(error)).not.toContain('short');
      expect(String(error)).not.toContain(valid.SUPABASE_SERVICE_ROLE_KEY);
    }
  });

  it('redacts service keys and bcrypt hashes recursively', () => {
    const redacted = JSON.stringify(redactSecrets({
      key: valid.SUPABASE_SERVICE_ROLE_KEY,
      nested: [valid.OVERVIEW_PASSWORD_HASH],
    }));
    expect(redacted).not.toContain('sb_secret_');
    expect(redacted).not.toContain('$2b$12$');
    expect(redacted).toContain('[REDACTED]');
  });
});
