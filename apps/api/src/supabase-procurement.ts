import type { AppConfig } from './config.js';
import type { ProcurementDependencies, ProcurementOverviewParams, SyncStatus } from './auth/types.js';

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

async function getOverview(config: AppConfig, params: ProcurementOverviewParams): Promise<unknown> {
  const response = await supabaseRequest(config, '/rest/v1/rpc/rpc_get_procurement_overview', {
    method: 'POST',
    body: JSON.stringify({
      p_company_id: params.companyId,
      p_coverage_days: params.coverageDays,
      p_search: params.search || null,
      p_priorities: params.priorities,
      p_supplier_statuses: params.supplierStatuses,
      p_needs_purchase: params.needsPurchase,
      p_no_supplier: params.noSupplier,
      p_insufficient_data: params.insufficientData,
      p_sort: params.sort,
      p_direction: params.direction,
      p_page: params.page,
      p_page_size: params.pageSize,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase procurement RPC error ${response.status}: ${text}`);
  }

  return response.json();
}

async function getSyncStatus(config: AppConfig): Promise<SyncStatus | null> {
  const response = await supabaseRequest(
    config,
    '/rest/v1/api_sync_status?select=finished_at,freshness_status&order=finished_at.desc.nullslast&limit=1',
    { headers: { Accept: 'application/json' } },
  );

  if (!response.ok) return null;

  const rows = (await response.json()) as Array<{
    finished_at: string | null;
    freshness_status: string | null;
  }>;

  const row = rows[0];
  if (!row) return null;

  return {
    finishedAt: row.finished_at,
    freshnessStatus: row.freshness_status,
  };
}

export function createSupabaseProcurementDependencies(config: AppConfig): ProcurementDependencies {
  return {
    getOverview: (params) => getOverview(config, params),
    getSyncStatus: () => getSyncStatus(config),
  };
}
