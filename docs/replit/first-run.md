# Replit First Run

## Import

1. Open `https://replit.com/import`.
2. Choose GitHub.
3. Connect the GitHub account that can access `Abdo-farrag/horeca-smart-os`.
4. Import the `main` branch after this PR is merged.
5. Replit will detect Node.js 22 and run `npm run dev` from `.replit`.

## App Secrets

Add these values in Replit **Secrets**. Never put them in `.replit`, source files, chat screenshots, or GitHub Actions logs.

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OVERVIEW_PASSWORD_HASH`
- `SESSION_SECRET`

`HOST=0.0.0.0` and `PORT=3000` are non-secret values already defined in `.replit`.

## Generate SESSION_SECRET

Run locally and store only the result in Replit Secrets:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## First verification

1. Press **Run**.
2. Confirm the web preview opens on port `5173`.
3. Open `/api/health` through the same preview domain.
4. Expected JSON:

```json
{"data":{"service":"horeca-smart-os-api","status":"ok"},"error":null}
```

The Vite development server proxies `/api` to the Fastify backend on port `3000`.

## Publishing gate

Do not publish until:

- required Supabase migrations are applied through the approved deployment process;
- the four production secrets are added separately in the Replit Publishing pane;
- login, logout, Reviewer, and Admin tests pass against a non-production account;
- no service-role key appears in browser source, network responses, or logs.
