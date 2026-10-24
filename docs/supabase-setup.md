# Connect this app to Supabase

The app now contains its Supabase schema, RLS rules, and family setup UI. It does not connect to a hosted project until local environment values are added and the migration is applied.

## 1. Create a project

Create a Supabase project, then copy its **Project URL** and **publishable key** into a local `.env.local` file based on `.env.example`:

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

The publishable key is intended for client apps. Never put a service-role/secret key in a `VITE_` variable or browser code.

## 2. Apply the database migration

Apply all files in `supabase/migrations/` to the project using the Supabase CLI (`supabase link` followed by `supabase db push`) or paste the migrations into the Supabase SQL Editor in timestamp order. The migrations create profiles, families, direct-by-email family members, cats, target rules, care events, account linking, RLS policies, the private cat-photo bucket, and family management functions used by the workspace. The Google profile-photo migration adds each signed-in member's avatar URL to their profile so it can be shown to other family members. The family-member-names migration fills names from Google account metadata and lets family members edit display names. The family-deletion migration adds the permission-checked function used to delete a family and its related database records. The custom-care-actions migration lets a family customize and add care actions, supports monthly goals, and stores each action's name, icon, and unit on care events so history stays unchanged after later edits.

For a local Supabase stack, install the Supabase CLI and run `supabase start` followed by `supabase db reset` from the repository root.

## 3. Configure Google sign-in

There are two different redirect settings:

1. In Google Cloud Console → APIs & Services → Credentials → your Google OAuth Web client, add the Supabase callback under **Authorized redirect URIs**. It must be `https://your-project-ref.supabase.co/auth/v1/callback`, using the project URL above. Google reports `redirect_uri_mismatch` when this callback is missing or differs from the request.
2. In Supabase Dashboard → Authentication → URL Configuration, set **Site URL** to your app URL and add the app's exact origin to **Redirect URLs**. For local development this is usually `http://localhost:8443`. The app sends `window.location.origin` as its redirect target, so use the origin shown in the browser address bar (including scheme and port). A Figma preview or LAN address may have a different origin.

Then in Supabase Dashboard → Authentication → Providers, enable Google and enter the Google OAuth client ID and client secret. Keep the client secret in the Supabase Dashboard, not in this repo. Google sign-in is the only provider in this release.

## 4. Try family setup

Restart Vite after adding `.env.local`. Open **Family workspace**, sign in, create a family, and add cats and people. The family timezone starts from the creator's device. A person added by email is immediately listed; if the account does not exist yet, signing in with that same email links it to the family automatically.

## Important current scope

Once configured, the family workspace and care tracker use Supabase for family members, cats, targets, care events, and private photos. Family care updates are shared through Realtime. Existing browser-only cats, tracker totals, and logs are not imported automatically; the original local demo data remains on that device until a deliberate import flow is added.
