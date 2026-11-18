# Getting a YouTube Data API key

**Generate beatmap** has to find the song's video on YouTube. Pasting a YouTube link into the
Title field always works with no key. Typing a **title and artist** and letting the game find the
video needs a free **YouTube Data API v3** key. The key is used only by the server (the mock, or
the Spring Boot backend) to search YouTube and read video details. It never downloads audio and
never reaches the browser.

## Get the key (about 5 minutes, free)

1. Go to <https://console.cloud.google.com/> and sign in with a Google account.
2. **Make a project:** the project picker at the top → **New project** → name it (for example
   `rythm-architect`) → **Create**, then select it.
3. **Turn on the API:** the menu → **APIs & Services → Library** → search **YouTube Data API v3** →
   open it → **Enable**.
4. **Make the key:** **APIs & Services → Credentials → + Create credentials → API key**. Copy the
   key it shows (it starts with `AIza`).
5. **Lock it down (recommended):** on the key's page, click **Edit API key**:
   - *API restrictions* → **Restrict key** → tick only **YouTube Data API v3**.
   - *Application restrictions* → **None** for Render (its outgoing addresses change), or **IP
     addresses** with your server's address if it has a fixed one. (Not "Websites": the key is
     used from a server, not a page.)
   - **Save**.
   Google may ask you to set up the *OAuth consent screen* first: you don't need it for an API
   key, so skip it if you can.

## Give it to the game

- **Mock server (`npm run dev`):** create `frontend/.env.local` (git ignores it) with
  ```
  YOUTUBE_API_KEY=AIza...
  ```
  then restart `npm run dev`. `frontend/.env.example` shows the format.
- **Spring Boot backend on your machine (PowerShell),** from `backend/`:
  ```powershell
  $env:YOUTUBE_API_KEY = "AIza..."
  .\mvnw spring-boot:run
  ```
- **Render:** the backend service → **Environment** → add `YOUTUBE_API_KEY` → **Save, rebuild,
  and deploy**.

**Check it:** in the game, type a title and artist that aren't in the bank and press **Generate
beatmap**. The video should come up. Without a key the dialog says a key is needed (and that you
can paste a link instead).

## Limits

The free quota is **10,000 units a day** per project. Each search by name costs about **101**
(a search is 100, the video details 1), so roughly **95 name searches a day**. Pasted links use
YouTube's oEmbed and cost nothing. The quota resets at midnight Pacific time. You can see use under
**APIs & Services → YouTube Data API v3 → Quotas**. If a search fails with "quota exceeded",
paste links until it resets.

Keep the key out of git and out of any `VITE_` variable. If it leaks, delete it under
**Credentials** and make a new one.
