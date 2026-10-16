# Backend specification and implementation plan

**Status:** Implementation in progress  
**Scope:** Family-shared cat care tracking, authentication, and a later iOS release  
**Current app:** React 19 + Vite; data is stored in browser `localStorage`

## 1. Product direction

The app lets members of a household sign in, see the same cats and care history on their own devices, record care, and compare progress with daily or weekly targets. A member's identity comes from their signed-in account rather than a name field stored on one browser.

The first shared version should stay small: one family per account, multiple people and cats per family, a shared activity history, and targets. It should not need a custom always-on API server.

## 2. Proposed architecture

Use **Supabase** for managed Postgres, authentication, and cat-photo storage. Keep the frontend, database migrations, and any server-side functions in this repository:

```text
src/                      React app and data-access layer
supabase/config.toml       Local Supabase project configuration
supabase/migrations/       Versioned SQL schema and row-level security policies
supabase/functions/        Optional trusted server-side operations
```

The browser talks to Supabase using its public project URL and anon/publishable key. These are not secrets; access must be enforced with Postgres row-level security (RLS). Never put a service-role key in frontend code.

This keeps the **source code and deployment instructions** in one repo. Production will still use hosted services: a frontend host serves the built React app, while Supabase hosts the database, auth, and file storage. A later CI/deploy workflow can coordinate both from this repo. Do not promise a single runtime or a single atomic deploy.

### Environments

- Local: Supabase CLI local stack plus Vite; migrations are the source of truth.
- Preview/staging: isolated Supabase project and frontend preview deployment.
- Production: separate Supabase project and frontend deployment.
- Store all project URLs and public client keys in environment configuration. Keep provider secrets and service-role keys only in Supabase/provider secret stores.

## 3. Core data model

`auth.users` is managed by Supabase. Application tables reference its UUID. Use UUID primary keys for application records.

### `profiles`

One row per authenticated person. `user_id` is both primary key and foreign key to `auth.users.id`; optional display name and timestamps. Email remains managed by Auth. Do not copy provider tokens into this table.

### `families`

One row per household: `id`, `name`, `timezone` (IANA name such as `Asia/Singapore`), `created_by`, `created_at`, `updated_at`. The creating device supplies the initial timezone; any member can edit it later. The timezone determines calendar boundaries for daily/weekly summaries.

### `family_members`

Join table between people and families: `family_id`, nullable `user_id`, normalized `email`, `display_name`, `added_by`, and `added_at`. A person can belong to only one family; unique indexes enforce this by authenticated user ID and normalized email.

Every family member can edit family settings, cats, and targets. Adding a member creates their family row immediately by email; they do not need to approve a request. If they already have an account, it is linked immediately. Otherwise, the row is linked when they later sign in with the same email. No invitation email is sent in the first version.

### `cats`

Each cat belongs to one family: `id`, `family_id`, `name`, optional `photo_path`, optional display color, `created_at`, `updated_at`, and optional `archived_at`. Store photo files in a private Supabase Storage bucket; keep only the object path in the row. Generate access-limited URLs when displaying photos.

### `care_events`

Append-only source of truth for activity. One row records one care action or an explicit correction:

- `id`, `family_id`, `cat_id`, `actor_user_id`
- `metric` (initial values: `treats`, `kibble`, `wet_food`, `teeth_pawing`, `fountain`, `poop`, `pee`, `ear_cleaning`, `play`)
- `amount_delta` (numeric; positive for care recorded, negative only for a correction)
- `unit` where useful (pieces, spoons, cans, sessions; fixed by metric where possible)
- `occurred_at` (`timestamptz`, UTC instant), `created_at`
- optional `note`
- optional `reverses_event_id` referencing the event being corrected

The actor is the authenticated person. Do not accept an arbitrary `who` value from the client. For binary checks, record an event with amount `1`; for repeatable counts, add one event per action or an event with the corresponding quantity. Wet food can use fractional cans (for example `0.1`) so partial-can tracking is represented consistently. Corrections preserve history rather than erasing who recorded the original action.

Add indexes for `(cat_id, occurred_at desc)`, `(family_id, occurred_at desc)`, and `(cat_id, metric, occurred_at)`. Retain event history; compute current totals and period summaries from events. If performance later requires cached summaries, treat them as rebuildable derived data.

### `target_rules`

Targets describe expectations; they are not daily or weekly records. A rule has `id`, `family_id`, `cat_id`, `metric`, `cadence` (`daily` or `weekly`), `target_amount`, `unit`, `effective_from`, optional `effective_until`, and timestamps. A unique active rule per `(cat_id, metric, cadence)` is a reasonable first constraint.

If families later need weekday-specific schedules, add a normalized child table such as `target_weekdays(target_id, weekday)` rather than storing many duplicated target/day rows. Target changes should have an effective date so old reports can retain their historical context.

## 4. Reporting periods

Do not create `day` or `week` rows in the first version. They are views over `care_events` and `target_rules`:

- **Today/by day:** sum events for a cat and metric between local midnight and the next local midnight in the family's timezone.
- **By week:** sum events over the chosen week using the family's configured week start (initially Monday) and timezone.
- Compare those totals with matching target rules to compute progress and completion.
- Keep the underlying timestamps in UTC; calculate the local boundaries server-side or consistently in a shared date utility.

This avoids many-to-many day/week joins, duplicate calendar records, and errors around daylight-saving transitions. A future reporting cache can be introduced if query volume makes this necessary.

## 5. Authentication and family access

### Sign-in

- Support Google sign-in for Gmail users and Sign in with Apple for Apple users, through Supabase Auth OAuth providers.
- Persist the authenticated user UUID as the care-event actor.
- Create/update `profiles` when a user first signs in, using a trusted database trigger or server-side operation.
- Provide sign-out and account deletion paths before public launch.
- If Google is offered as the primary account login in an iOS App Store app, review Apple's current equivalent-login requirements; Sign in with Apple is the planned option.

### Family onboarding

1. New user signs in.
2. User creates a family; creator is linked as its first member.
3. Any family member can add people by email and create cats.
4. A pending email membership is linked automatically when that person signs in with the same email.
5. All shared reads and writes are scoped to a family membership.

For the first family trial, an owner can add family members through a simple invite flow. Avoid sharing one login among relatives: separate identities are needed for trustworthy “who did what” records.

### RLS policy requirements

- A user can read a family only if they have a membership in it.
- A user can read cats, targets, and events only for families they belong to.
- A member can add care events only as themselves and only for a cat in one of their families.
- Members cannot spoof `actor_user_id`, `family_id`, or a mismatched `cat_id`.
- Every family member can edit family settings, cats, and target rules.
- Family membership additions go through a database function that checks family access and enforces the one-family-per-person rule.
- Storage policies must scope cat-photo paths to family membership.

Implement schema and RLS together in migrations, and validate policies with at least two accounts in different families before using real family data.

## 6. Frontend changes

The UI should not call Supabase directly from every component. Add a small data-access boundary, for example:

```text
src/data/
  client.ts           Supabase client configuration
  auth.ts             sign-in, sign-out, session
  families.ts         family and membership operations
  cats.ts             cat profile and photo operations
  careEvents.ts       create events and query history/summaries
  targets.ts          read/update target rules
```

Components should consume typed application operations, not know database table details. Keep a local/demo data adapter while onboarding and migration are being built, then use the shared adapter for signed-in families. Add loading, empty, offline/error, and retry states before replacing the current local-first behavior.

## 7. Migration from the current local-only app

Current data is stored in `purrfect-cats`, `purrfect-trackers`, `purrfect-care-logs`, and `purrfect-member-name` localStorage keys. The current tracker totals are snapshots, while the care log contains timestamped actions and browser-local member names.

Before enabling sync:

1. Add a versioned local data export/import format and a visible JSON export for backup.
2. On first signed-in setup, let the user choose the family and cat mapping for existing local data.
3. Import timestamped logs with the signed-in user as actor only after explaining that old browser-entered names cannot be verified as individual accounts.
4. Import current totals only if the matching historical events are unavailable; label these as opening adjustments with a date and importing user.
5. Prevent duplicate imports with an import batch ID/source ID and show a success/partial failure summary.
6. Keep the original local copy until the user confirms that cloud data is present.

Do not silently merge multiple browsers' localStorage snapshots: that can double counts and overwrite newer information.

## 8. Delivery plan

### Phase 0 — Data and UX decisions (confirmed)

- A person belongs to one family.
- All family members can edit.
- The creating device supplies the initial timezone; family members can edit it.
- Define metric names, units, and correction behavior; especially wet food partial quantities and undone actions.
- A person is added directly by email, with no separate request/approval step. If they do not have an account yet, they can join by later signing in with that email.
- Account deletion/export remain launch-hardening work.

### Phase 1 — Backend foundation

- Add Supabase CLI/config and local setup instructions.
- Create migrations for profiles, families, memberships, cats, care events, and targets.
- Add indexes, constraints, initial RLS/storage policies, and generated TypeScript DB types.
- Add isolated development/staging project setup and secrets guidance.

### Phase 2 — Shared-family MVP

- Add Google and Apple sign-in and session handling.
- Add create-family onboarding and family timezone selection.
- Move cat profiles and goals to the shared database.
- Write care events with the authenticated actor and query daily/weekly summaries.
- Add direct-by-email member addition and membership management.
- Add clear connection status and recoverable network errors.

### Phase 3 — Local-data import and hardening

- Add backup/export and guided import of existing cats, goals, and logs.
- Test family isolation, membership changes, corrections, timezone edges, and concurrent updates.
- Add account deletion and a privacy policy before public distribution.
- Set up backups, migration workflow, and a production rollback plan.

### Phase 4 — iOS distribution

- Add Capacitor iOS project while continuing to use the React UI.
- Implement/test OAuth return URLs and deep links in the native shell.
- Add native capabilities only where useful (photo picker, notifications, widgets later).
- Review current App Store login, privacy, and minimum-functionality requirements before submission.

## 9. Out of scope for the first shared release

- Google Sheets as the system of record.
- Custom Express/Node API server.
- Complex recurring schedules, multiple target rules per metric, or arbitrary reporting calendars.
- Offline multi-device conflict resolution; first shared release should require a connection to write and clearly show failures.
- Billing, public profiles, social feeds, and analytics beyond essential operational monitoring.

## 10. Acceptance criteria for the shared MVP

- Two separately authenticated family members see the same cats, targets, and care history on different devices.
- A care event always records the signed-in actor and a timestamp; the UI shows the actor, action, and local time.
- A member of Family A cannot read or change Family B's cats, targets, events, or photos, including by changing request IDs.
- Daily and weekly totals use the family's timezone and match the detailed event history.
- Target progress updates from shared event data and remains capped visually at 100% while preserving over-goal totals.
- Network errors never appear as successful writes; the user can retry without duplicate events.
- Existing browser data can be backed up and imported with a clear account of what was imported.

## 11. Open decisions

1. Should the initial weekly boundary be Monday in the family timezone?
2. Should a care correction be a negative adjustment linked to the original event, or should users only undo their own most recent action?
3. Is the first cloud trial limited to a trusted family group, or should account creation be open?
