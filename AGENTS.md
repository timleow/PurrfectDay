# figma-make-app

React + Vite + Tailwind CSS project running inside Figma Make.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Primary application component and the usual starting point for UI work
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `.mise.toml` - Toolchain versions for Node.js and pnpm

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: oxfmt

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.

## Code quality

- Use double quotes for strings containing apostrophes (`"We're here to help"`), or escape them in single-quoted strings. An unescaped apostrophe in a single-quoted string breaks the build.
- Ensure JSX tags are closed and braces are balanced.
- Export components as default exports.

## Project onboarding

PurrfectDay is a family cat-care tracker. The main experience is the Care tab, where an authenticated family member quickly records feeding, play, litter, and other care actions. Cats provides a per-cat overview; Family manages the shared family, people, cats, and goals. Each family member signs in with their own Google account so care entries can be attributed to the correct person. Apple sign-in is out of scope for this release.

### Local development

- Install the pinned toolchain from `.mise.toml`, then run `pnpm install --frozen-lockfile`.
- Start Vite with `pnpm dev`. In the Figma Make workspace, a Vite server is normally already running on `$PORT` (default 8443); use the preview panel in that environment.
- The app needs `.env.local` to connect to Supabase. Copy `.env.example` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. `.env.local` is ignored by Git. Never put a Supabase service-role key, Google OAuth client secret, or other server secret in a `VITE_` variable or commit one.
- Useful commands: `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`, and `pnpm format`.

### Architecture and source map

- `src/App.tsx` owns the primary app shell, tab navigation, care tracking interactions, and app-level state.
- `src/components/` contains the family portal and focused UI components. `src/data/` contains Supabase access and family data operations; keep SQL and Supabase table details in this data layer rather than spreading them through UI components.
- `src/index.css` contains global styling, theme rules, responsive layout, and page/navigation transitions. Component-specific styling lives beside the component.
- `src/lib/` contains shared integrations/utilities where applicable. `supabase/migrations/` is the source of truth for schema and RLS changes.
- The client uses Supabase for Google authentication, shared family/cat/target/care data, Realtime updates, and private cat photo storage. There is no custom Node/Express API server. The React app is a static site; Supabase is the hosted backend.
- Keep the app in this repository. A future iOS release is expected to use a native wrapper such as Capacitor unless the product requirements change; a full Swift rewrite is not currently planned.

### Product and data decisions

- A person can belong to one family. All family members can manage family settings, cats, targets, and people.
- Adding a person by email adds them directly to the family; no invitation acceptance flow is required. An account that is created later links by matching email.
- The family timezone defaults to the creating device's timezone. Do not expose it as a free-text field.
- Care events record the authenticated actor and timestamp. Users may undo their own recent actions; one member cannot undo another member's actions.
- Daily and weekly summaries are computed from timestamped care events and target rules. Do not add day/week database entities unless the product model changes.
- Preserve quick recording on mobile, including stable counts during rapid taps. Keep the Care, Cats, and Family navigation clear and usable on small screens.
- Treat `docs/release-acceptance.md` as the user-facing release acceptance checklist. Apple authentication is explicitly out of scope for this release.

### Supabase setup and migration status

Follow [`docs/supabase-setup.md`](docs/supabase-setup.md) for project credentials, Google OAuth configuration, redirect URLs, storage, and migration instructions. The broader data model and future work are in [`docs/backend-plan.md`](docs/backend-plan.md).

Migration status reported by the project owner:

| Migration | Status |
| --- | --- |
| `20261016000000_family_care_backend.sql` | Applied to the Supabase project |
| `20261017000000_family_management.sql` | Applied to the Supabase project |
| `20261017100000_google_profile_photos.sql` | Added locally; apply to Supabase before relying on Google profile photos for other family members |
| `20261018100000_family_member_names.sql` | Added locally; apply to Supabase to enable shared member-name editing and Google-name defaults |
| `20261019100000_family_deletion.sql` | Added locally; apply to Supabase to enable family deletion |

When adding a migration, use a new timestamped SQL file and never edit a migration that has already been applied. Test access policies against separate families/accounts where possible. The app's browser-facing Supabase URL and publishable key are safe to expose; RLS must enforce access. Keep OAuth provider secrets in Supabase settings.

### Deployment and CI

- The repository is connected to GitHub at `https://github.com/timleow/PurrfectDay.git` on `main`.
- Netlify serves the static build from `dist/`; [`netlify.toml`](netlify.toml) defines the build, publish directory, Node version, and SPA fallback. Read [`docs/netlify-deployment.md`](docs/netlify-deployment.md) for connecting GitHub, setting Netlify environment variables, and adding production redirect URLs to Supabase.
- GitHub Actions in `.github/workflows/ci.yml` runs tests, TypeScript checking, and a production build on pushes to `main`, pull requests, and manual dispatch.
- `.env*` files are ignored except `.env.example`. Before committing, inspect `git status` and ensure `.env.local`, credentials, and generated build output are not included.

### Plans and known scope

- [`docs/backend-plan.md`](docs/backend-plan.md): backend architecture, schema decisions, data migration, security, and future iOS direction.
- [`docs/supabase-setup.md`](docs/supabase-setup.md): create/configure Supabase and Google sign-in.
- [`docs/netlify-deployment.md`](docs/netlify-deployment.md): GitHub-to-Netlify deployment and production setup.
- [`docs/release-acceptance.md`](docs/release-acceptance.md): release requirements and coverage checklist.
- Google sign-in is supported for this release; Apple sign-in, billing, and a custom server are not in scope. The app can be deployed as a static frontend while Supabase supplies its backend services.
