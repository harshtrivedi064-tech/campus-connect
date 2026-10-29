# Gemini AI chat setup

The AI chat endpoint uses the Google Gemini API. Keep the API key private and
store it only as a server environment variable.

1. Create a Gemini API key in Google AI Studio.
2. In Render, open the Campus Loop service's **Environment** settings and add:
   - `GEMINI_API_KEY`: your Gemini API key
   - `GEMINI_MODEL`: optional; defaults to `gemini-2.5-flash`
3. Save the settings and redeploy the service.
4. Sign in to Campus Loop and open **AI Chat**.

For local development, set `GEMINI_API_KEY` in the terminal before starting
the backend. Chat messages are sent to Google Gemini and are not persisted by
Campus Loop. The endpoint requires login and allows up to 10 requests per
minute per account.
