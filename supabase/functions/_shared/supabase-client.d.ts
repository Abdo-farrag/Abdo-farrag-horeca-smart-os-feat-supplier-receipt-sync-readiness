declare module "npm:@supabase/supabase-js@2.110.8" {
  export type SupabaseOperationError = {
    message: string;
  };

  export type SupabaseOperationResult<T = unknown> = Promise<{
    data: T;
    error: SupabaseOperationError | null;
  }>;

  export type SupabaseSelectQuery = {
    limit(
      count: number,
    ): SupabaseOperationResult<Record<string, unknown>[] | null>;
  };

  export type SupabaseTableQuery = {
    insert(values: unknown): SupabaseOperationResult;
    select(columns: string): SupabaseSelectQuery;
    upsert(
      values: unknown,
      options?: { onConflict?: string },
    ): SupabaseOperationResult;
  };

  export type SupabaseClient = {
    from(table: string): SupabaseTableQuery;
    rpc(
      functionName: string,
      args?: Record<string, unknown>,
    ): SupabaseOperationResult;
  };

  export function createClient(
    url: string,
    key: string,
    options?: {
      auth?: {
        persistSession?: boolean;
        autoRefreshToken?: boolean;
      };
    },
  ): SupabaseClient;
}
