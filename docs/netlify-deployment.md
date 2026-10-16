# Netlify deployment plan

The app is a static React/Vite site. Netlify builds it from the GitHub repository and publishes `dist/`; Supabase remains the hosted database, auth provider, and photo storage. There is no app server to deploy.

## 1. Publish the repository to GitHub

Create an empty **private** GitHub repository, then push this project’s `main` branch. Do not add a README, license, or `.gitignore` in GitHub during creation; this project already has its files. The current workspace did not have a Git repository or remote configured when this plan was written.

After GitHub authentication is available, the GitHub CLI flow is:

```sh
gh auth login
gh repo create <repository-name> --private --source=. --remote=origin --push
```

GitHub’s [instructions for adding locally hosted code](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github) document the CLI and manual remote options.

## 2. Connect the repository to Netlify

In Netlify, choose **Add new project → Import an existing project**, connect GitHub, and select the repository. Deploy the `main` branch. The checked-in [`netlify.toml`](../netlify.toml) configures:

- Build command: `pnpm build`
- Publish directory: `dist`
- Node.js: 22
- A fallback to `index.html` for client-side routes

The `packageManager` field pins pnpm to the version used by this project. Netlify’s [Vite guide](https://docs.netlify.com/build/frameworks/framework-setup-guides/vite/) covers its build and publish settings; its [SPA guide](https://docs.netlify.com/build/configure-builds/javascript-spas/) describes the fallback rewrite.

## 3. Add production environment values

In Netlify’s project environment-variable settings, add these values for production (and deploy previews if you want authenticated preview builds):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Use the matching values from local `.env.local`. The publishable key is delivered to browsers by design; database access must remain protected by the existing Supabase RLS policies. **Do not add a Supabase service-role key, Google OAuth client secret, or any other server secret to a `VITE_` variable or this repository.** Keep the Google client secret in the Supabase provider settings. Netlify documents storing [environment variables](https://docs.netlify.com/configure-builds/environment-variables/) outside the repository.

## 4. Point Supabase auth at the deployed site

After Netlify provides the production URL:

1. In Supabase Authentication → URL Configuration, set the Site URL to the production site URL.
2. Add the production URL to the allowed redirect URLs. Add the Netlify Deploy Preview URL pattern if previews will be used for Google sign-in.
3. In Google Cloud Console, keep the authorized OAuth redirect URI set to the Supabase callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`). The OAuth callback remains on Supabase; only the post-login redirect points back to the Netlify site.
4. Confirm the existing Supabase migrations have been applied to the production project and Google sign-in is enabled.

See [Supabase setup](supabase-setup.md) for the provider and migration details.

## 5. Verify the production deployment

Before inviting family members, check the Netlify deploy succeeds and verify Google sign-in, family creation/loading, adding and editing cats, photo upload, care logging and undo, and shared updates from a second signed-in family member. If authentication fails only on the deployed domain, check the Supabase allowed redirect URLs and Netlify environment values first.

## Secret handling

`.env.local` and other `.env*` files are ignored; only the placeholder `.env.example` is allowed into Git. The `.gitignore` also excludes Netlify local state, build output, dependencies, and common local files. Before the first push, inspect the staged file list and confirm `.env.local` is not staged.
