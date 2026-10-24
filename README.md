# ClipKraft

**Turn any topic into a finished, narrated video, right in the browser.**

Live site: https://clipkraft.github.io/

ClipKraft takes a topic and walks it through five steps:

1. **Topic**: type a topic or get topic ideas for your niche. Pick format (16:9 YouTube or 9:16 Shorts), length, tone and language.
2. **Script**: AI writes a hook-first script split into scenes. Every line is editable; scenes can be reordered, rewritten, added or deleted.
3. **Visuals**: AI creates one image per scene in the style you choose. Any scene can also get a 5-second AI video clip, or your own uploaded image/video.
4. **Voice**: AI voiceover in 25+ languages with many voices (Standard, Natural, Premium, Expressive). One clip per scene. Optional background music.
5. **Edit & Export**: the auto-edit times every shot to its voiceover, adds camera motion (Ken Burns), transitions and burned-in captions. Preview it, tweak it, export an MP4 (1080p or 720p).

---

## Open it in VS Code

1. Unzip the folder and open it in VS Code (**File → Open Folder…**).
2. VS Code will suggest two extensions (from `.vscode/extensions.json`): **Live Server** and **Prettier**. Install them.
3. Right-click `index.html` → **Open with Live Server**. The site opens at something like `http://127.0.0.1:5500/`.

No Live Server? Any static server works, for example:

```bash
npx serve .
# or
python -m http.server 8000
```

> The page must be served over `http://` or `https://`, not opened as a `file://` path. The AI library and the browser's module system both require it.

There is **no build step**, no `npm install`, no framework. Edit a file, save, refresh.

---

## Folder map

```
clipkraft/
├── index.html            Landing page (what the product does + "Start creating")
├── app.html              The studio (the 5-step editor)
├── admin.html            Owner tools: edit public site settings, see projects in this browser
├── settings.json         Public site settings the admin page edits (name, colours, banner…)
├── css/
│   └── style.css         All styling: dark theme, landing page, editor, mobile layout
├── js/
│   ├── config.js         ★ Brand name, tagline, colours. Change the name here only.
│   ├── brand.js          Puts the brand name/wordmark on the pages, applies settings.json, builds the PWA manifest
│   ├── app.js            The studio's brain: UI for every step, project state, preview player
│   ├── admin.js          Owner tools page: site settings editor, publish to GitHub, local projects
│   ├── ai.js             Every AI call (AI mode): topic ideas, script, images, video clips, voices
│   ├── free.js           Free mode: Wikipedia-based ideas/scripts, free on-device voice
│   ├── tts-worker.js     Background thread that runs the free voice model
│   ├── engine.js         The auto-editor: timeline, Ken Burns, transitions, captions, audio mix
│   ├── exporter.js       MP4 export (WebCodecs encoder + MP4 muxer, with a fallback)
│   └── store.js          Saves projects and media in the browser (IndexedDB)
├── vendor/
│   └── mp4-muxer.mjs     Small open-source library (MIT) that packs video+audio into an .mp4
├── icons/                Logo (SVG) and app icons (PNG)
├── sw.js                 Service worker: lets the app be installed and load offline
├── .nojekyll             Tells GitHub Pages to serve files as-is
├── .vscode/              Recommended VS Code extensions (Live Server, Prettier)
├── tools/signin-log/     Google Apps Script for the optional sign-in log (Code.gs)
└── README.md             This file
```

---

## How it works

```
                 ┌──────────────────── your browser ─────────────────────┐
                 │                                                        │
  You ──clicks──▶│  app.js (UI + project state)                           │
                 │     │                                                  │
                 │     ├──▶ ai.js ──── puter.js ──────────────▶ Puter cloud
                 │     │      topic ideas, script  (puter.ai.chat)        │   (AI models,
                 │     │      images               (puter.ai.txt2img)     │    billed to the
                 │     │      video clips          (puter.ai.txt2vid)     │    user's own
                 │     │      voiceover            (puter.ai.txt2speech)  │    Puter account)
                 │     │                                                  │
                 │     ├──▶ store.js ── IndexedDB (projects, images, audio, clips)
                 │     │                                                  │
                 │     ├──▶ engine.js ── builds the timeline:             │
                 │     │      scene length = its voiceover + padding      │
                 │     │      draws any frame: image + motion +           │
                 │     │      transition + captions on a <canvas>         │
                 │     │      mixes all voice clips (+ music) into one track
                 │     │                                                  │
                 │     └──▶ exporter.js ── draws every frame (30 fps),    │
                 │            encodes H.264 video + AAC/Opus audio with   │
                 │            WebCodecs, packs it into an MP4 → Download   │
                 └────────────────────────────────────────────────────────┘
```

The **preview player** and the **export** use the exact same drawing code (`drawFrame` in `engine.js`), so the exported video matches what you saw.

### Why there is no separate backend

Everything a backend would normally do is covered by two things:

- **Puter.js** (`<script src="https://js.puter.com/v2/">`) gives sign-in, AI models and cloud storage straight from the browser. It uses a **"user-pays" model**: each user signs in with their own free Puter account and their AI usage comes out of *their* monthly allowance. You (the developer) pay ₹0 no matter how many users you have, and there are no API keys to hide.
- **The browser itself** does the heavy video work: Canvas draws frames, Web Audio mixes sound, WebCodecs encodes video, IndexedDB stores projects. Nothing is uploaded to edit or export.

So the whole product is static files, which is why it can be hosted free on GitHub Pages.

### Why WebCodecs and not ffmpeg.wasm

ffmpeg.wasm needs a ~30 MB download and, for speed, special server headers (COOP/COEP) that GitHub Pages can't set (and those headers would also break the sign-in popup). WebCodecs uses the device's own hardware video encoder, needs no headers, and renders a 1-minute 1080p video in well under a minute on a normal laptop. Browsers without WebCodecs fall back to recording the canvas in real time (MediaRecorder).

---

## Common changes

**Rename the product**: edit `js/config.js`:

```js
export const BRAND = { name: 'ClipKraft', tagline: 'Topic in. Finished video out.', ... };
```

The page titles, logo wordmark, app name (when installed) and footer all read from here. (The wordmark colours the part after the second capital letter, e.g. Clip**Kraft**.)

**Change colours**: edit the variables at the top of `css/style.css` (`--accent`, `--accent2`, `--grad`, `--bg`…). Also update the gradient in `icons/logo.svg`.

**Add a language**: add `{ code, name }` to `LANGUAGES` in `js/ai.js`. Standard voices use Amazon Polly language codes; the other voice types speak whatever language the script is in.

**Change caption look**: `drawCaption()` in `js/engine.js` (font size, colours, position).

**Change AI models**: `IMAGE_MODELS`, `VIDEO_MODEL` and `speak()` in `js/ai.js`. Model names are listed at https://docs.puter.com.

---

## Free mode and AI mode

The studio has two modes, switched with the **Free mode / AI mode** toggle in the bar right under the top bar (always visible, on phones too). Projects keep working when you switch. Free mode works whether or not you are signed in to Puter: it never calls Puter.

| | **Free mode** (default when signed out) | **AI mode** (Puter account) |
|---|---|---|
| Sign-in | None | Puter account (free) |
| Cost | ₹0, no credits ever | Uses the user's free monthly Puter AI credits |
| Topic ideas | Wikipedia search for your niche, or built-in evergreen ideas | AI suggestions |
| Script | Built from the topic's Wikipedia article (real facts, many languages), with a template fallback | AI-written, any tone |
| Visuals | Animated title cards + your own uploads | AI images (+ optional AI video clips) + uploads |
| Voice | Free on-device voice (Kokoro, 22 English voices), or your own recordings | Standard / Natural / Premium / Expressive voices in 25+ languages |
| Export | Same MP4 export | Same MP4 export |

**How the free voice works.** `js/tts-worker.js` runs a small open-source speech model (Kokoro-82M) inside the browser, in a background thread. The first use downloads about 90 MB, which the browser caches; after that it works offline. It takes a few seconds per scene on a laptop and is slower on phones. It speaks English only; for other languages use AI mode or upload your own recording per scene.

**Your own media (both modes):**
- **Photo or video per scene**: every scene card on the Visuals step has "⬆ Upload photo/video". A photo gets the zoom motion; a clip plays in its scene.
- **Your own voiceover**: on the Voice step, "⬆ Upload your voiceover" takes one audio file for the whole video. It is split across the scenes at the pauses (each scene gets a share in proportion to its script text), and the edit is timed to it. Each scene also has ⬆ to upload a recording for just that scene.
- **Music**: "⬆ Upload music" on the Voice step loops a track under the narration and fades it out at the end.

**When Puter credits run out** (AI video clips use them fastest; a free account can run out after about 3 clips):
- "Generate all images" sends the first image on its own. If Puter says the credits are used up, no more requests are sent in that batch, so the user doesn't get a pile of errors.
- Every scene that didn't get an AI image keeps its free animated title card, so the video still plays and exports.
- An orange banner appears: "Your Puter AI credits are used up" with a **Use Free mode (no credits)** button. The app remembers this for the rest of the month in that browser and won't send more AI requests that would fail; "I added credits" turns AI calls back on.
- Nothing already made is lost.

---

## Owner tools (admin.html) and what an admin area needs

Open `admin.html` (https://clipkraft.github.io/admin.html).

**This is not a private admin login, and that's on purpose.** ClipKraft is a static site with no server. Any password or "is this the admin?" check written into the JavaScript can be read and bypassed by anyone, so it would only look secure. Instead:

- **Anyone can open the page**, but it can only **change the live site** with a GitHub token that can write to the `ClipKraft/clipkraft.github.io` repository. Only the repo owner can create one.
- **Sign-in and passwords belong to Puter.** ClipKraft never sees, stores or lists anyone's password, and there is no list of users' logins anywhere. Never build a form that collects passwords.

**What the page does**

- **Site settings** (stored in `settings.json`, read by every page): brand name, tagline, two accent colours, an announcement banner, and an on/off switch for AI video clips.
- **Publish**: saves `settings.json` straight to the GitHub repo using a GitHub *fine-grained* token (access to only the `ClipKraft/clipkraft.github.io` repo, permission **Contents: Read and write**). The token is kept only in the browser you paste it into. Without a token, use **Download settings.json** and upload it to the repo on github.com.
- **Projects in this browser**: every project saved in the browser you're using, with an Open button.
- **Your AI usage** for the month (from your own Puter account).

**What it can't show.** Each user's projects live in their own browser, and their AI usage is billed to their own Puter account. So other users, their projects and their usage aren't visible anywhere.

**A real admin area later** (user list with sign-in times, usage analytics, paid plans) needs a small server that *checks* who is asking. Plan: a serverless function (Puter Worker or Cloudflare Worker, both have free tiers) that receives the user's Puter session token, verifies it server-side, records only the username and sign-in time (with a clear notice to users), and serves the admin dashboard data only after verifying the request comes from the owner's account.

---

## Sign-in log (optional, free): who signed in and when

This records **only the Puter username, the time and the page** each time someone signs in, into a Google Sheet you own. It never records passwords: ClipKraft never sees passwords at all, because Puter's own sign-in window handles them.

**Set it up (about 5 minutes, free):**

1. Go to https://sheets.new and name the sheet, e.g. *ClipKraft sign-ins*.
2. In the sheet: **Extensions → Apps Script**.
3. Delete what's in the editor and paste everything from `tools/signin-log/Code.gs`. Click **Save**.
4. Click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**.
   - Description: `Sign-in log`
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, then **Authorize access** and allow it with your Google account. (Google may warn that the app isn't verified because it's your own script: click *Advanced → Go to … (unsafe)*.)
6. Copy the **Web app URL** (it ends in `/exec`). Opening it in a browser should say "Sign-in log is running."
7. In `js/config.js`, paste it in: `export const SIGNIN_LOG_URL = 'https://script.google.com/macros/s/…/exec';` and commit to GitHub.

From then on, every sign-in adds a row to the **Sign-ins** tab. To count unique users, put this in any empty cell: `=COUNTUNIQUE('Sign-ins'!B2:B)`.

When the URL is set, the studio tells users at sign-in: *"We record your Puter username and sign-in time to count users."* With the URL empty, nothing is sent anywhere.

**Honest limits.** This is a usage counter, not security. The web app URL is public (it's in the site's code), so someone could send fake rows. It can't prove who signed in, and it can't control access. Anything that has to be trustworthy (an admin area, paid plans) needs a server that verifies sign-ins; see Next steps.

---

## Deploy / update on GitHub Pages

The live site is the `main` branch of the `clipkraft.github.io` repository in the `ClipKraft` GitHub organization, served by GitHub Pages from the root folder at https://clipkraft.github.io/.

To update:

```bash
git clone https://github.com/ClipKraft/clipkraft.github.io.git
cd clipkraft.github.io
# edit files…
git add .
git commit -m "Describe your change"
git push
```

GitHub Pages republishes in about a minute. If you change files, also bump `VERSION` in `sw.js` (and the `?v=` number on `css/style.css` and `js/app.js` in the HTML files and in `sw.js`) so phones pick up the new version on a normal refresh. The service worker always checks the server for newer files and the page reloads itself once when a new version takes over.

You can also edit files directly on github.com (pencil icon → Commit changes).

---

## Known limits

- **AI credits**: every user gets Puter's free monthly allowance. AI video clips are by far the most expensive step; images and voices are cheap. When a user runs out, Puter shows them a top-up prompt.
- **AI video clips** take from tens of seconds to a few minutes each.
- **Export speed** depends on the device. Laptops are fast; long 1080p exports on older phones are slow, so 720p is offered.
- **Audio codec**: the exporter uses AAC audio when the browser offers an AAC encoder (usually Chrome/Edge on Windows and Mac, and Safari). Where AAC isn't available (e.g. Chrome on Linux) it uses Opus inside the MP4, which YouTube and modern players accept.
- **Storage**: projects live in the browser that made them. Clearing site data deletes them.

---

## Next steps

1. **Secure admin area**: a small serverless function that verifies sign-ins server-side (see "Owner tools" above).
2. **Pro plan with Razorpay**: add a "Pro" tier (e.g. watermark-free exports, premium templates, a higher-quality default voice). Razorpay Payment Links or Checkout work from a static site; to verify payments securely you'd add one small serverless function (Puter Workers, Cloudflare Workers or Vercel) that checks the Razorpay webhook and stores "pro" status in Puter's key-value store.
3. **Android app**: the site is already an installable PWA ("Add to Home screen"). For the Play Store, wrap it with **Capacitor** (`npx cap init`, `npx cap add android`) or publish it as a **Trusted Web Activity** with Bubblewrap.
4. **Templates**: intro/outro cards, lower-thirds, logo watermark, brand colours per channel.
5. **Music library**: a set of royalty-free tracks to pick from.
6. **Cloud sync**: save projects to the user's Puter storage (`puter.fs`) so they open on any device.
7. **Direct upload**: post the finished video to YouTube via Google's API.

---

Built with Puter.js · Kokoro TTS via kokoro-js (Apache-2.0) · Wikipedia API · mp4-muxer (MIT) · plain HTML, CSS and JavaScript.

Scripts in Free mode use text from Wikipedia (CC BY-SA). Check facts and credit Wikipedia in your video description when you use them.
