import { SIGNIN_LOG_URL, BRAND } from './config.js';

// AI layer. Every call runs on the signed-in user's own Puter account (user-pays),
// so the app itself needs no API keys and no server.

export const LANGUAGES = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'en-IN', name: 'English (India)' },
  { code: 'hi-IN', name: 'Hindi' },
  { code: 'es-ES', name: 'Spanish (Spain)' },
  { code: 'es-US', name: 'Spanish (Latin America)' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
  { code: 'it-IT', name: 'Italian' },
  { code: 'nl-NL', name: 'Dutch' },
  { code: 'pl-PL', name: 'Polish' },
  { code: 'ru-RU', name: 'Russian' },
  { code: 'tr-TR', name: 'Turkish' },
  { code: 'arb', name: 'Arabic' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'ko-KR', name: 'Korean' },
  { code: 'cmn-CN', name: 'Chinese (Mandarin)' },
  { code: 'sv-SE', name: 'Swedish' },
  { code: 'da-DK', name: 'Danish' },
  { code: 'nb-NO', name: 'Norwegian' },
  { code: 'fi-FI', name: 'Finnish' },
  { code: 'ro-RO', name: 'Romanian' },
  { code: 'cy-GB', name: 'Welsh' },
  { code: 'is-IS', name: 'Icelandic' },
];
export const langName = (code) => (LANGUAGES.find((l) => l.code === code) || { name: code }).name;

export const VOICE_PROVIDERS = [
  { id: 'kokoro', label: 'Free', note: 'Free, on-device English voices. No sign-in or credits. Downloads a ~90 MB voice model once.', free: true },
  { id: 'aws-polly', label: 'Standard', note: 'Dozens of voices in 25+ languages. Cheapest.' },
  { id: 'openai', label: 'Natural', note: 'Very natural voices that speak the script\'s language.' },
  { id: 'elevenlabs', label: 'Premium', note: 'Studio-quality multilingual voices.' },
  { id: 'gemini', label: 'Expressive', note: 'Expressive voices that follow a speaking style.' },
];
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const GEMINI_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Zephyr', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

export const IMAGE_MODELS = [
  { id: 'gemini-3.1-flash-image', label: 'Balanced', note: 'Good quality, fast' },
  { id: 'gpt-image-2', label: 'Best quality', note: 'Most detailed, slower' },
  { id: 'grok-imagine-image', label: 'Vivid', note: 'Bold, punchy images' },
  { id: '@cf/black-forest-labs/flux-1-schnell', label: 'Fastest', note: 'Quick drafts, lowest cost' },
];
export const VIDEO_MODEL = 'wan2.7-i2v';

export const STYLES = [
  { id: 'cinematic', label: 'Cinematic', prompt: 'cinematic film still, dramatic lighting, shallow depth of field, rich color grade, highly detailed' },
  { id: 'documentary', label: 'Documentary', prompt: 'documentary photograph, natural light, realistic, editorial, high detail' },
  { id: 'collage', label: 'Paper collage', prompt: 'textured paper collage illustration, torn paper edges, vintage print texture, editorial explainer style' },
  { id: 'illustration', label: 'Illustration', prompt: 'detailed digital illustration, clean shapes, vibrant palette, storybook quality' },
  { id: '3d', label: '3D render', prompt: 'stylized 3D render, soft global illumination, octane style, crisp details' },
  { id: 'anime', label: 'Anime', prompt: 'anime key visual, cel shading, expressive lighting, detailed background' },
  { id: 'minimal', label: 'Minimal', prompt: 'minimal flat vector art, bold geometric shapes, limited color palette, clean background' },
  { id: 'noir', label: 'Dark & moody', prompt: 'dark moody atmosphere, high contrast, film grain, mysterious, cinematic' },
];

export function puterReady() {
  return new Promise((resolve, reject) => {
    if (window.puter) return resolve(window.puter);
    let n = 0;
    const iv = setInterval(() => {
      if (window.puter) { clearInterval(iv); resolve(window.puter); }
      else if (++n > 150) { clearInterval(iv); reject(new Error('The AI service did not load. Check your connection and refresh.')); }
    }, 100);
  });
}

export async function isSignedIn() {
  const p = await puterReady();
  try { return !!p.auth.isSignedIn(); } catch (e) { return false; }
}
export async function getUser() {
  const p = await puterReady();
  try { return await p.auth.getUser(); } catch (e) { return null; }
}
export async function signIn() {
  const p = await puterReady();
  const res = await p.auth.signIn({ attempt_temp_user_creation: true });
  logSignIn();
  return res;
}

// Sends username + time + page to the owner's sign-in counter, only if SIGNIN_LOG_URL is set in config.js.
// Passwords never pass through this app: Puter's own sign-in window handles them.
async function logSignIn() {
  if (!SIGNIN_LOG_URL) return;
  try {
    const u = await getUser();
    if (!u || !u.username) return;
    await fetch(SIGNIN_LOG_URL, {
      method: 'POST',
      mode: 'no-cors', // Apps Script doesn't send CORS headers; the row is still written
      body: JSON.stringify({ username: u.username, page: location.pathname.split('/').pop() || 'index.html', app: BRAND.name }),
    });
  } catch (e) { /* counting is best-effort and never blocks the app */ }
}
export async function signOut() {
  const p = await puterReady();
  try { p.auth.signOut(); } catch (e) { /* ignore */ }
}

// True when Puter refused because the account has no AI credit left (HTTP 402).
export function isCreditsError(e) {
  if (!e) return false;
  const code = e.code || (typeof e.error === 'string' ? e.error : e.error && e.error.code);
  const msg = String(e.message || e.msg || (e.error && e.error.message) || e);
  return code === 'insufficient_funds' || code === 'subscription_required' || e.status === 402
    || /insufficient[_ ]funds|insufficient|low balance|credits? .*used up|out of credit/i.test(msg);
}

export function friendlyError(e) {
  const code = e && (e.code || e.error || (e.error && e.error.code));
  const msg = (e && (e.message || e.msg || (e.error && e.error.message))) || String(e);
  if (code === 'insufficient_funds' || /insufficient/i.test(msg)) return 'Your AI credits for this month are used up. Add credits to your Puter account or try again next month.';
  if (code === 'too_many_requests' || /rate/i.test(msg)) return 'Too many requests at once. Wait a few seconds and try again.';
  if (e && e.errorCode === 'moderation_flagged') return 'The AI refused this prompt. Try rewording it.';
  if (code === 'auth_window_closed') return 'Sign-in was closed before finishing.';
  if (code === 'popup_blocked') return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
  return typeof msg === 'string' ? msg.slice(0, 300) : 'Something went wrong.';
}

function textOf(resp) {
  if (resp == null) return '';
  if (typeof resp === 'string') return resp;
  const c = resp.message && resp.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x.text || '')).join('');
  if (resp.text) return resp.text;
  return String(resp);
}

function parseJSON(text) {
  const t = text.replace(/```json|```/g, '').trim();
  const first = Math.min(...['{', '['].map((ch) => { const i = t.indexOf(ch); return i < 0 ? Infinity : i; }));
  const last = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (first === Infinity || last < 0) throw new Error('The AI answer was not in the expected format. Try again.');
  return JSON.parse(t.slice(first, last + 1));
}

async function chat(prompt, opts = {}) {
  const p = await puterReady();
  const resp = await p.ai.chat(prompt, opts);
  return textOf(resp);
}

async function chatJSON(prompt, opts) {
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try { return parseJSON(await chat(prompt, opts)); } catch (e) { lastErr = e; if (e && e.code) throw e; }
  }
  throw lastErr;
}

export async function topicIdeas({ niche, language, format, count = 8 }) {
  const prompt = `You are a viral video strategist. Suggest ${count} specific, high-interest video topics${niche ? ` for this niche or keywords: "${niche}"` : ' across mystery, history, science, business, tech and curiosities'}.
The videos are ${format === '9:16' ? 'vertical short-form (YouTube Shorts / Reels / TikTok)' : 'horizontal YouTube videos'}.
Write the titles and hooks in ${langName(language)}.
Each idea needs a punchy title (max 70 characters) and a one-sentence hook explaining why people will click.
Answer with JSON only, no commentary: {"ideas":[{"title":"...","hook":"..."}]}`;
  const j = await chatJSON(prompt);
  const ideas = Array.isArray(j) ? j : j.ideas || [];
  return ideas.filter((x) => x && x.title).slice(0, count).map((x) => ({ title: String(x.title), hook: String(x.hook || '') }));
}

export async function writeScript({ topic, lengthSec, tone, language, format, extra }) {
  const words = Math.round(lengthSec * 2.4);
  const scenes = Math.max(3, Math.min(40, Math.round(lengthSec / (format === '9:16' ? 4.5 : 7))));
  const prompt = `Write a narrated ${format === '9:16' ? 'vertical short video' : 'YouTube video'} script about: "${topic}".
Language of the narration: ${langName(language)}. Tone: ${tone}. Target length: about ${lengthSec} seconds of narration (~${words} words in total).
Split it into about ${scenes} scenes. Rules:
- Scene 1 is a strong hook: the most surprising fact or question, no greeting, no "in this video".
- Each scene's narration is 1 to 3 short spoken sentences, natural to read aloud.
- Keep facts accurate; hedge anything uncertain.
- End with a satisfying payoff and a short call to follow or subscribe.
- For each scene, also write "visual": a vivid, concrete image description in English for an AI image generator (subject, setting, composition, lighting). No text, letters, logos or watermarks in the image.
${extra ? 'Extra instructions from the creator: ' + extra + '\n' : ''}Answer with JSON only: {"title":"...","scenes":[{"narration":"...","visual":"..."}]}`;
  const j = await chatJSON(prompt);
  const list = (j.scenes || []).filter((s) => s && s.narration);
  if (!list.length) throw new Error('The AI returned an empty script. Try again.');
  return { title: String(j.title || topic), scenes: list.map((s) => ({ narration: String(s.narration).trim(), visual: String(s.visual || s.narration).trim() })) };
}

export async function rewriteScene({ narration, topic, language, instruction }) {
  const prompt = `Rewrite this narration line for a video about "${topic}" in ${langName(language)}. ${instruction || 'Make it punchier and clearer.'} Keep it about the same length. Answer with the new narration text only.\n\n${narration}`;
  return (await chat(prompt)).trim().replace(/^"|"$/g, '');
}

// Fetch a media URL into a Blob. Falls back to the platform's CORS-free fetch for hosted URLs.
export async function urlToBlob(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.blob();
  } catch (e) {
    const p = await puterReady();
    if (url.startsWith('data:') || url.startsWith('blob:')) throw e;
    const r = await p.net.fetch(url);
    return await r.blob();
  }
}

export async function generateImage(prompt, { model, format, style, testMode } = {}) {
  const p = await puterReady();
  const st = STYLES.find((s) => s.id === style);
  const full = `${prompt}. ${st ? st.prompt : ''}. ${format === '9:16' ? 'Vertical 9:16 composition.' : 'Wide 16:9 composition.'} No text, no captions, no watermark.`;
  const opts = { aspect_ratio: format === '9:16' ? '9:16' : '16:9' };
  if (model) opts.model = model;
  if (testMode) opts.test_mode = true;
  const img = await p.ai.txt2img(full, opts);
  return urlToBlob(img.src || String(img));
}

export async function generateVideoClip(prompt, imageBlob, { format, seconds = 5, testMode } = {}) {
  const p = await puterReady();
  const opts = {
    model: VIDEO_MODEL,
    seconds,
    size: '720P',
    width: format === '9:16' ? 720 : 1280,
    height: format === '9:16' ? 1280 : 720,
  };
  if (imageBlob) opts.input_reference = imageBlob;
  if (testMode) opts.test_mode = true;
  const vid = await p.ai.txt2vid(`${prompt}. Smooth cinematic camera motion.`, opts);
  return urlToBlob(vid.src || String(vid));
}

const voiceCache = {};
export async function listVoices(provider) {
  if (provider === 'openai') return OPENAI_VOICES.map((v) => ({ id: v, name: v[0].toUpperCase() + v.slice(1) }));
  if (provider === 'gemini') return GEMINI_VOICES.map((v) => ({ id: v, name: v }));
  if (voiceCache[provider]) return voiceCache[provider];
  const p = await puterReady();
  const list = await p.ai.txt2speech.listVoices({ provider });
  voiceCache[provider] = (list || []).map((v) => ({ id: v.id, name: v.name || v.id, language: v.language, engines: v.supported_engines, description: v.description, labels: v.labels }));
  return voiceCache[provider];
}

export async function speak(text, voice, { tone, testMode } = {}) {
  const p = await puterReady();
  const opts = { provider: voice.provider };
  if (voice.provider === 'aws-polly') {
    opts.voice = voice.voice || 'Joanna';
    opts.engine = voice.engine || 'neural';
    opts.language = voice.language || 'en-US';
  } else if (voice.provider === 'openai') {
    opts.model = 'gpt-4o-mini-tts';
    opts.voice = voice.voice || 'alloy';
    opts.response_format = 'mp3';
    opts.instructions = `Narrate like a professional ${tone || 'documentary'} voice-over artist. Clear, engaging, well paced.`;
  } else if (voice.provider === 'elevenlabs') {
    opts.model = 'eleven_multilingual_v2';
    if (voice.voice) opts.voice = voice.voice;
    opts.output_format = 'mp3_44100_128';
  } else if (voice.provider === 'gemini') {
    opts.voice = voice.voice || 'Kore';
    opts.instructions = `Narrate in a ${tone || 'engaging documentary'} style, clear and well paced.`;
  }
  if (testMode) opts.test_mode = true;
  const audio = await p.ai.txt2speech(text.slice(0, 2900), opts);
  return urlToBlob(audio.src || String(audio));
}
