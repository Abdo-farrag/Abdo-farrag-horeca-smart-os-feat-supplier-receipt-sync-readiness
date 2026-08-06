import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATIONS: Array<{ file: string; name: string }> = [
  {
    file: resolve(__dirname, '../../supabase/migrations/20260726100000_procurement_approval_workflow.sql'),
    name: '20260726100000_procurement_approval_workflow',
  },
];

export async function runPendingMigrations(dbUrl: string): Promise<void> {
  // Only run if DATABASE_URL points to the Supabase database
  // The local helium/heliumdb is empty — skip if that's the case
  if (!dbUrl || dbUrl.includes('helium')) {
    console.log('[migrate] Local database detected, skipping Supabase migration');
    return;
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    // Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    for (const migration of MIGRATIONS) {
      const { rows } = await client.query(
        'SELECT 1 FROM _migrations WHERE name = $1',
        [migration.name],
      );

      if (rows.length > 0) {
        console.log(`[migrate] ${migration.name} already applied, skipping`);
        continue;
      }

      console.log(`[migrate] Applying ${migration.name}...`);
      const sql = readFileSync(migration.file, 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [migration.name]);
      console.log(`[migrate] ${migration.name} applied successfully`);
    }

    await client.end();
  } catch (error) {
    console.error('[migrate] Error:', error instanceof Error ? error.message : error);
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}
