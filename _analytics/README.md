# Maintenance

## Configuration

Copy `wrangler.example.jsonc` to `wrangler.jsonc` and configure the existing
resource identifiers. Keep the `DB` binding and `migrations_dir` setting.
Local configuration and exports are excluded by `.gitignore`.
Do not commit credentials or exported data.

## Checks

Run from the repository root using Node.js 22.13 or later:

```sh
node --test _analytics/analytics.test.mjs
```

Database migrations are in `migrations/`. Read-only queries are in
`traffic-reports.sql`; execute one statement at a time.
