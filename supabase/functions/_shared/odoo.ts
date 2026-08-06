export type JsonRecord = Record<string, unknown>;

export type OdooCredentials = {
  url: string;
  database: string;
  username: string;
  apiKey: string;
};

type JsonRpcError = {
  message?: string;
  data?: { message?: string };
};

type JsonRpcResponse<T> = {
  result?: T;
  error?: JsonRpcError;
};

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

export function readOdooCredentials(): OdooCredentials {
  return {
    url: requiredEnv("ODOO_URL").replace(/\/$/, ""),
    database: Deno.env.get("ODOO_DB")?.trim() || "DB-LIVE",
    username: requiredEnv("ODOO_USERNAME"),
    apiKey: requiredEnv("ODOO_API_KEY"),
  };
}

export async function odooRpc<T>(
  url: string,
  service: string,
  method: string,
  args: unknown[],
): Promise<T> {
  const response = await fetch(`${url.replace(/\/$/, "")}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: crypto.randomUUID(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Odoo HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json() as JsonRpcResponse<T>;
  if (payload.error) {
    throw new Error(
      payload.error.data?.message ?? payload.error.message ??
        "Unknown Odoo RPC error",
    );
  }
  if (!("result" in payload)) throw new Error("Odoo RPC returned no result");
  return payload.result as T;
}

export async function authenticateOdoo(
  credentials: OdooCredentials,
): Promise<number> {
  const uid = await odooRpc<number | false>(
    credentials.url,
    "common",
    "authenticate",
    [
      credentials.database,
      credentials.username,
      credentials.apiKey,
      {},
    ],
  );

  if (!uid) throw new Error("Odoo authentication failed");
  return uid;
}

export async function executeKw<T>(
  credentials: OdooCredentials,
  uid: number,
  model: string,
  method: string,
  positionalArgs: unknown[] = [],
  keywordArgs: JsonRecord = {},
): Promise<T> {
  return await odooRpc<T>(credentials.url, "object", "execute_kw", [
    credentials.database,
    uid,
    credentials.apiKey,
    model,
    method,
    positionalArgs,
    keywordArgs,
  ]);
}

export async function readableFields(
  credentials: OdooCredentials,
  uid: number,
  model: string,
  context: JsonRecord,
): Promise<Set<string>> {
  const fields = await executeKw<Record<string, unknown>>(
    credentials,
    uid,
    model,
    "fields_get",
    [],
    { attributes: ["string", "type"], context },
  );
  return new Set(Object.keys(fields));
}
