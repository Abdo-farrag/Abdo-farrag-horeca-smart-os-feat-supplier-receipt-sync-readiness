import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import {
  authorizeEmployee,
  clearOverviewSessionCookie,
  createOverviewSessionCookie,
  LoginRateLimiter,
  verifyOverviewPassword,
  verifyOverviewSession,
} from './auth/service.js';
import type { BuildAppOptions, ProcurementOverviewParams } from './auth/types.js';

interface LoginBody {
  password?: string;
}

type OverviewQuerystring = {
  company?: string;
  coverageDays?: string;
  search?: string;
  page?: string;
  pageSize?: string;
};

type ReviewApproveBody = {
  productCode: string;
  decisionStatus: string;
  approvedQty?: number | null;
  approvedSupplierId?: number | null;
  approvedSupplierName?: string | null;
  buyerNote?: string | null;
  expectedVersion: number;
};

type ReviewBulkBody = {
  items: Array<{
    productCode: string;
    approvedQty?: number | null;
    approvedSupplierId?: number | null;
    approvedSupplierName?: string | null;
    expectedVersion: number;
  }>;
  decisionStatus: string;
  buyerNote?: string | null;
};

type ReviewQuerystring = {
  company?: string;
  search?: string;
  priority?: string;
  decisionStatus?: string;
  noSupplier?: string;
  page?: string;
  pageSize?: string;
};

const VALID_COVERAGE_DAYS = new Set([7, 14, 21, 30]);
const VALID_DECISION_STATUSES = new Set(['NEW', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DEFERRED']);

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const rateLimiter = new LoginRateLimiter();

  app.get('/api/health', async () => ({
    data: { service: 'horeca-smart-os-api', status: 'ok' },
    error: null,
  }));

  if (options.auth) {
    const auth = options.auth;
    const hasOverviewAccess = (cookieHeader?: string) =>
      auth.overviewAuthDisabled || verifyOverviewSession(cookieHeader, auth.sessionSecret);

    app.post<{ Body: LoginBody }>('/api/overview-access/login', async (request, reply) => {
      const ip = request.ip;
      if (rateLimiter.isBlocked(ip)) {
        return reply.code(429).send({ data: null, error: { code: 'TOO_MANY_ATTEMPTS' } });
      }

      const password = request.body?.password;
      const passwordOk = auth.overviewAuthDisabled || (!!password && (await verifyOverviewPassword(auth, password)));
      if (!passwordOk) {
        const attempts = rateLimiter.registerFailure(ip);
        const status = attempts > 5 ? 429 : 401;
        return reply.code(status).send({
          data: null,
          error: { code: status === 429 ? 'TOO_MANY_ATTEMPTS' : 'INVALID_CREDENTIALS' },
        });
      }

      rateLimiter.reset(ip);
      reply.header('set-cookie', createOverviewSessionCookie(auth.sessionSecret));
      return reply.code(204).send();
    });

    app.post('/api/overview-access/logout', async (_request, reply) => {
      reply.header('set-cookie', clearOverviewSessionCookie());
      return reply.code(204).send();
    });

    app.get('/api/overview-access/session', async (request, reply) => {
      if (!hasOverviewAccess(request.headers.cookie)) {
        return reply.code(401).send({ data: null, error: { code: 'UNAUTHORIZED' } });
      }
      return reply.code(200).send({ data: { authenticated: true }, error: null });
    });

    app.get('/api/auth/me', async (request, reply) => {
      const result = await authorizeEmployee(auth, request.headers.authorization, 'reviewer');
      if (result.status !== 200) {
        return reply.code(result.status).send({
          data: null,
          error: { code: result.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN' },
        });
      }
      return reply.code(200).send({ data: result.user, error: null });
    });

    app.get('/api/auth/admin-check', async (request, reply) => {
      const result = await authorizeEmployee(auth, request.headers.authorization, 'admin');
      if (result.status !== 200) {
        return reply.code(result.status).send({
          data: null,
          error: { code: result.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN' },
        });
      }
      return reply.code(204).send();
    });

    if (options.procurement) {
      const procurement = options.procurement;

      app.get<{ Querystring: OverviewQuerystring }>(
        '/api/procurement/overview',
        async (request, reply) => {
          if (!hasOverviewAccess(request.headers.cookie)) {
            return reply.code(401).send({ data: null, error: { code: 'UNAUTHORIZED' } });
          }

          const q = request.query;

          const rawCompany = q.company;
          const companyId =
            rawCompany === '1' ? 1 : rawCompany === '2' ? 2 : null;

          const rawCoverage = Number(q.coverageDays ?? '14');
          const coverageDays = VALID_COVERAGE_DAYS.has(rawCoverage) ? rawCoverage : 14;

          const search = q.search?.trim() ?? '';
          const page = Math.max(1, Number(q.page ?? '1') || 1);
          const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? '50') || 50));

          const params: ProcurementOverviewParams = {
            companyId,
            coverageDays,
            search,
            priorities: [],
            supplierStatuses: [],
            needsPurchase: null,
            noSupplier: null,
            insufficientData: null,
            sort: 'priority',
            direction: 'desc',
            page,
            pageSize,
          };

          try {
            const [rpcResult, syncStatus] = await Promise.all([
              procurement.getOverview(params),
              procurement.getSyncStatus(),
            ]);

            const result = rpcResult as {
              data: { rows: unknown[]; summary: unknown; pagination: unknown };
            };

            return reply.code(200).send({
              data: {
                rows: result.data.rows,
                summary: result.data.summary,
                pagination: result.data.pagination,
                syncStatus,
              },
              error: null,
            });
          } catch {
            return reply.code(503).send({ data: null, error: { code: 'PROCUREMENT_UNAVAILABLE' } });
          }
        },
      );
    }

    if (options.review) {
      const review = options.review;

      // GET — list review products with filters
      app.get<{ Querystring: ReviewQuerystring }>(
        '/api/procurement/review',
        async (request, reply) => {
          if (!hasOverviewAccess(request.headers.cookie)) {
            return reply.code(401).send({ data: null, error: { code: 'UNAUTHORIZED' } });
          }

          const q = request.query;
          const page = Math.max(1, Number(q.page ?? '1') || 1);
          const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? '50') || 50));

          try {
            const result = await review.getReviewProducts({
              company: q.company ?? 'all',
              search: q.search ?? '',
              priority: q.priority ?? 'all',
              decisionStatus: q.decisionStatus ?? 'all',
              noSupplier: q.noSupplier === 'true',
              page,
              pageSize,
            });
            return reply.code(200).send(result);
          } catch {
            return reply.code(503).send({ data: null, error: { code: 'REVIEW_UNAVAILABLE' } });
          }
        },
      );

      // Approve/update a single recommendation
      app.post<{ Body: ReviewApproveBody }>(
        '/api/procurement/review/approve',
        async (request, reply) => {
          if (!hasOverviewAccess(request.headers.cookie)) {
            return reply.code(401).send({ data: null, error: { code: 'UNAUTHORIZED' } });
          }

          const body = request.body;
          if (!body.productCode || !body.decisionStatus) {
            return reply.code(400).send({ data: null, error: { code: 'MISSING_REQUIRED_FIELDS' } });
          }

          if (!VALID_DECISION_STATUSES.has(body.decisionStatus)) {
            return reply.code(400).send({ data: null, error: { code: 'INVALID_DECISION_STATUS' } });
          }

          try {
            const result = await review.approveRecommendation(
              body.productCode,
              body.decisionStatus,
              body.approvedQty ?? null,
              body.approvedSupplierId ?? null,
              body.approvedSupplierName ?? null,
              body.buyerNote ?? null,
              body.expectedVersion,
            );
            return reply.code(200).send({ data: result, error: null });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
            if (message.includes('VERSION_CONFLICT')) {
              return reply.code(409).send({ data: null, error: { code: 'VERSION_CONFLICT', message } });
            }
            return reply.code(400).send({ data: null, error: { code: 'APPROVAL_FAILED', message } });
          }
        },
      );

      // Bulk update recommendations
      app.post<{ Body: ReviewBulkBody }>(
        '/api/procurement/review/bulk',
        async (request, reply) => {
          if (!hasOverviewAccess(request.headers.cookie)) {
            return reply.code(401).send({ data: null, error: { code: 'UNAUTHORIZED' } });
          }

          const body = request.body;
          if (!body.items || !body.items.length || !body.decisionStatus) {
            return reply.code(400).send({ data: null, error: { code: 'MISSING_REQUIRED_FIELDS' } });
          }

          if (!VALID_DECISION_STATUSES.has(body.decisionStatus)) {
            return reply.code(400).send({ data: null, error: { code: 'INVALID_DECISION_STATUS' } });
          }

          try {
            const items = body.items.map((item) => ({
              productCode: item.productCode,
              approvedQty: item.approvedQty ?? null,
              approvedSupplierId: item.approvedSupplierId ?? null,
              approvedSupplierName: item.approvedSupplierName ?? null,
              expectedVersion: item.expectedVersion,
            }));
            const result = await review.bulkUpdateRecommendations(
              items,
              body.decisionStatus,
              body.buyerNote ?? null,
            );
            return reply.code(200).send({ data: result, error: null });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
            return reply.code(400).send({ data: null, error: { code: 'BULK_UPDATE_FAILED', message } });
          }
        },
      );
    }
  }

  const candidatePaths = [
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), '../../apps/web/dist'),
  ];
  const webDistPath = candidatePaths.find((p) => fs.existsSync(p));

  if (webDistPath) {
    app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api')) {
        return reply.code(404).send({ data: null, error: { code: 'NOT_FOUND' } });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
