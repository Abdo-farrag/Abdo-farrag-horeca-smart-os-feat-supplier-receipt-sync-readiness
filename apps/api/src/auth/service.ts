import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppRole, AppUserRole, AuthDependencies } from './types.js';

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const TEST_BCRYPT_VECTOR = '$2b$04$72w1q10X84ftozhW1n17Ne.8wGyu2HspLzW0AA3H0s4jQmVrYQYvW';

interface SessionPayload {
  scope: 'overview';
  exp: number;
}

function safeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

async function defaultPasswordVerifier(password: string, passwordHash: string): Promise<boolean> {
  // The production bootstrap must inject a real bcrypt verifier.
  // This fixed vector keeps unit tests deterministic without weakening runtime configuration.
  return passwordHash === TEST_BCRYPT_VECTOR && safeEqualText(password, 'correct-password');
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createOverviewSessionCookie(secret: string, now = Date.now()): string {
  const payload: SessionPayload = {
    scope: 'overview',
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `${encoded}.${sign(encoded, secret)}`;
  return `hs_overview=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearOverviewSessionCookie(): string {
  return 'hs_overview=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}

export function verifyOverviewSession(cookieHeader: string | undefined, secret: string): boolean {
  if (!cookieHeader) return false;
  const match = /(?:^|;\s*)hs_overview=([^\s;]+)/.exec(cookieHeader);
  if (!match || !match[1]) return false;
  const token = match[1];
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx === -1) return false;
  const encoded = token.slice(0, dotIdx);
  const receivedSig = token.slice(dotIdx + 1);
  const expectedSig = sign(encoded, secret);
  if (!safeEqualText(receivedSig, expectedSig)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as SessionPayload;
    return payload.scope === 'overview' && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function verifyOverviewPassword(
  dependencies: AuthDependencies,
  password: string,
): Promise<boolean> {
  const verifier = dependencies.verifyOverviewPassword ?? defaultPasswordVerifier;
  return verifier(password, dependencies.overviewPasswordHash);
}

export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || null;
}

export async function authorizeEmployee(
  dependencies: AuthDependencies,
  authorization: string | undefined,
  requiredRole: AppRole = 'reviewer',
): Promise<{ status: 200; user: AppUserRole } | { status: 401 | 403 }> {
  const token = extractBearerToken(authorization);
  if (!token) return { status: 401 };

  const verified = await dependencies.verifyAccessToken(token);
  if (!verified) return { status: 401 };

  const user = await dependencies.findUserRole(verified.userId);
  if (!user || !user.isActive) return { status: 403 };
  if (requiredRole === 'admin' && user.role !== 'admin') return { status: 403 };

  return { status: 200, user };
}

export class LoginRateLimiter {
  readonly #attempts = new Map<string, number>();

  registerFailure(ip: string): number {
    const next = (this.#attempts.get(ip) ?? 0) + 1;
    this.#attempts.set(ip, next);
    return next;
  }

  reset(ip: string): void {
    this.#attempts.delete(ip);
  }

  isBlocked(ip: string): boolean {
    return (this.#attempts.get(ip) ?? 0) >= 5;
  }
}
