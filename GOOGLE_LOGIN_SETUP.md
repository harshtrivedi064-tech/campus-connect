# Google sign-in setup

Google sign-in needs OAuth credentials; do not commit the client secret.

1. In Google Cloud Console, create or select a project and configure the OAuth consent screen.
2. Create an OAuth client ID with application type **Web application**.
3. Add the deployed app's callback URL to **Authorized redirect URIs**:
   `https://<your-render-service>.onrender.com/auth/google/callback`
4. For local testing, also add:
   `http://localhost:3000/auth/google/callback`
5. In Render, open the Campus Loop service's **Environment** settings and set:
   - `GOOGLE_CLIENT_ID`: the OAuth client ID
   - `GOOGLE_CLIENT_SECRET`: the OAuth client secret
   - `GOOGLE_REDIRECT_URI`: the exact callback URL for the deployed app
6. For local testing, set those same variables in the terminal before starting the
   backend, using the localhost callback URL for `GOOGLE_REDIRECT_URI`.

The redirect URI configured in Google Cloud must exactly match
`GOOGLE_REDIRECT_URI`. Google-created accounts use the student role by default.
