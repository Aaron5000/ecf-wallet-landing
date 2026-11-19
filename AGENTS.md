# ECF landing page preview

The shared team preview URL is https://ecf-wallet-preview.vercel.app.

Whenever publishing an updated Vercel preview for this project:
1. Deploy the current project as a preview (not production).
2. Wait until the new deployment is READY.
3. Run `vercel alias set <new-deployment-url> ecf-wallet-preview.vercel.app`.
4. Verify the shared URL serves the updated page without authentication.
5. Give the user the shared URL, rather than the unique deployment URL.

The alias must be updated after each deployment; deploying alone does not move it.
Keep this file excluded from deployed website assets via .vercelignore.
