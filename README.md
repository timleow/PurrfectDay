# PurrfectDay

PurrfectDay helps a family keep track of their cats' care. Family members sign in separately, record care, and see shared cats, goals, and activity history.

The app is a React web app. Supabase provides Google sign-in, the shared database, realtime updates, and private cat photo storage. Netlify hosts the static frontend. The source code, database migrations, and deployment configuration live in this repository; there is no custom application server.

## Choose a guide

### For family members and testers

- Open the app URL shared by the family owner and sign in with the Google account they added to the family.
- Use **Care** for quick check-ins, **Cats** for cat summaries, and **Family** to see family members and manage family settings.
- For release behavior and what to check, see the [release acceptance checklist](docs/release-acceptance.md).
- If sign-in or shared data does not work, contact the family owner. They can use the [Supabase setup guide](docs/supabase-setup.md) to check account access and configuration.

### For developers

- [Local development](#local-development)
- [Architecture](#architecture)
- [Tests and CI](#tests-and-ci)
- [Backend plan](docs/backend-plan.md)
- [Supabase setup and OAuth](docs/supabase-setup.md)

### For the project owner / deployer

- [Netlify deployment guide](docs/netlify-deployment.md)
- [Supabase project setup](docs/supabase-setup.md)
- [Database migration status](#database-migrations)
- [Release acceptance checklist](docs/release-acceptance.md)

## Local development

Requirements are Node.js 22 and pnpm 10.34.3. The versions are pinned in [`.mise.toml`](.mise.toml) and [`package.json`](package.json).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Create `.env.local` from [`.env.example`](.env.example) and set the Supabase project URL and publishable key:

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

The `.env.local` file is ignored by Git. The publishable key is intended for browser use; never put a service-role key or Google OAuth client secret in a `VITE_` variable or commit one. Configure Google OAuth and the app redirect URLs in Supabase as described in the [Supabase setup guide](docs/supabase-setup.md). Apple sign-in is out of scope for this release.

## Architecture

```text
src/
  App.tsx               App shell, navigation, and care tracking
  components/           Family portal, cat overview, and sign-in UI
  data/                 Supabase access and care/family data operations
  index.css             Global styles, themes, responsive layout, animations
supabase/
  migrations/           Versioned Postgres schema, functions, and RLS policies
.github/workflows/      GitHub Actions CI
```

The browser talks to Supabase using the public project URL and publishable key. Postgres row-level security (RLS) scopes shared data to family members. Care entries use the signed-in person as the actor. Do not bypass RLS or accept a person identity supplied by the client.

The main entities are profiles, families, family members, cats, target rules, and timestamped care events. Day and week summaries are derived from events and the family's timezone; there are no persisted day/week tables. A person belongs to one family, all family members can edit, and adding someone by email adds them directly without a separate acceptance flow.

## Database migrations

Apply migrations in timestamp order using the Supabase CLI or the SQL Editor. See [Supabase setup](docs/supabase-setup.md) for instructions.

For the family owner's currently configured Supabase project:

| Migration | Status |
| --- | --- |
| [`20261016000000_family_care_backend.sql`](supabase/migrations/20261016000000_family_care_backend.sql) | Applied |
| [`20261017000000_family_management.sql`](supabase/migrations/20261017000000_family_management.sql) | Applied |
| [`20261017100000_google_profile_photos.sql`](supabase/migrations/20261017100000_google_profile_photos.sql) | Pending; apply to enable Google profile photos for other family members |

This status is specific to the owner's project and may differ for another Supabase project. Never edit a migration that has already been applied; add a new timestamped migration instead.

## Tests and CI

Run the automated checks locally with:

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

GitHub Actions runs those checks on pushes to `main`, pull requests, and manual dispatch. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Deployment

The app builds to `dist/` with `pnpm build`. [`netlify.toml`](netlify.toml) configures the build, publish directory, Node.js version, and SPA fallback. Netlify needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in its environment settings. Supabase must allow the deployed site URL as an auth redirect. Follow the [Netlify deployment guide](docs/netlify-deployment.md) for the complete setup.

## Product scope and plans

- Google sign-in is supported. Apple sign-in is out of scope for this release.
- The app is designed for family testing. Account deletion, local-data import, billing, offline multi-device writes, and a custom API server are not currently part of the release scope.
- Keep the web app and backend migrations in this repository. A future iOS release may use a native wrapper such as Capacitor; a Swift rewrite is not currently planned.
- See the [backend plan](docs/backend-plan.md) for the data model, security requirements, local-data import plan, and future iOS work.
