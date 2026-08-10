import { buildApp } from './app.js';
import { createSupabaseAuthDependencies } from './auth/supabase-auth.js';
import { createSupabaseCompanyPurchaseDependencies } from './company-purchase.js';
import { createSupabaseProcurementDependencies } from './supabase-procurement.js';
import { createSupabaseReviewDependencies } from './supabase-review.js';
import { loadConfig, redactSecrets } from './config.js';

function start(): void {
  const config = loadConfig(process.env);
  const app = buildApp({
    auth: createSupabaseAuthDependencies(config),
    procurement: createSupabaseProcurementDependencies(config),
    review: createSupabaseReviewDependencies(config),
    companyPurchase: createSupabaseCompanyPurchaseDependencies(config),
  });

  app.listen({ port: config.PORT, host: config.HOST }).catch((error: unknown) => {
    app.log.error(redactSecrets(error));
    process.exit(1);
  });
}

try {
  start();
} catch (error: unknown) {
  console.error(redactSecrets(error));
  process.exit(1);
}
