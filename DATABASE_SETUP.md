# Persistent database setup

The Render Free web service has an ephemeral filesystem, so it cannot safely
store application data in `backend/data.json` or event-photo files. Production
now uses PostgreSQL when `DATABASE_URL` is set. The app creates its tables
automatically at startup and stores user accounts, posts, attendance, events,
and event photos in the database.

## Free Supabase setup

1. Create a Supabase project on the Free plan.
2. In the Supabase project, open **Connect** and copy the PostgreSQL connection
   string for the **Session pooler**.
3. In Render, open the `campus-loop` web service and go to **Environment**.
4. Add an environment variable:
   - Key: `DATABASE_URL`
   - Value: the connection string copied from Supabase
5. Save the change and let Render redeploy. Check the deploy logs for
   `Server running`; a database connection error means the URL or credentials
   need checking.

Keep the connection string private. Do not commit it to the repository or
share it in chat. The Supabase Free database can pause after a period of
inactivity; its data remains, but the project might need to be resumed.

Existing data from Render's ephemeral filesystem is not copied automatically.
Export or back up any data that is still available before deploying this
change. Data already erased by Render cannot be restored by this application.

For local development, when `DATABASE_URL` is not set, the app continues to use
`backend/data.json`. Production refuses to start without `DATABASE_URL` so it
does not silently write new data to Render's temporary filesystem.
