// Free mode: everything here runs without sign-in and without AI credits.
//  - Topic ideas + scripts are built from Wikipedia's free public API (real facts, many languages),
//    with a template writer as a fallback so it never dead-ends.
//  - Voiceover is generated on the user's device by a small open-source speech model (Kokoro, English),
//    downloaded once (~90 MB) and cached by the browser.

const WIKI_LANG = { arb: 'ar', cmn: 'zh', nb: 'no' };
export function wikiLang(code) { const base = (code || 'en').split('-')[0]; return WIKI_LANG[base] || base; }

const EVERGREEN = [
  ['The Mary Celeste', 'A ship found drifting with every sailor gone.'],
  ['D. B. Cooper', 'He hijacked a plane, jumped with the cash and vanished.'],
  ['Tunguska event', 'Something flattened 80 million trees in Siberia.'],
  ['Voynich manuscript', 'A book nobody on Earth can read.'],
  ['Dyatlov Pass incident', 'Nine hikers, one tent cut open from the inside.'],
  ['Antikythera mechanism', 'A 2,000-year-old computer pulled from a shipwreck.'],
  ['Great Emu War', 'The army that lost a war against birds.'],
  ['Library of Alexandria', 'What was really lost when it burned?'],
  ['Bermuda Triangle', 'The truth behind the world\'s most famous sea mystery.'],
  ['Göbekli Tepe', 'A temple older than farming itself.'],
  ['Chernobyl disaster', 'The night a reactor exploded and a city emptied.'],
  ['Nokia', 'How the king of phones lost everything.'],
  ['Blockbuster LLC', 'The company that laughed at Netflix.'],
  ['Black hole', 'Places where even light can\'t escape.'],
  ['Tardigrade', 'The tiny animal that survives space.'],
  ['Taj Mahal', 'The story behind the world\'s most famous tomb.'],
];

async function wikiAPI(lang, params) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  Object.entries({ format: 'json', origin: '*', ...params }).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url);
  if (!r.ok) throw new Error('Wikipedia is not reachable right now.');
  return r.json();
}
const stripHTML = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");

export async function freeTopicIdeas({ niche, language, count = 8 }) {
  const lang = wikiLang(language);
  if (!niche || !niche.trim()) {
    const pick = [...EVERGREEN].sort(() => Math.random() - 0.5).slice(0, count);
    return pick.map(([title, hook]) => ({ title, hook }));
  }
  try {
    const j = await wikiAPI(lang, { action: 'query', list: 'search', srsearch: niche, srlimit: String(count + 4), srprop: 'snippet' });
    const res = (j.query && j.query.search) || [];
    const ideas = res.filter((x) => !/disambiguation|\(.*list.*\)|^List of/i.test(x.title)).slice(0, count)
      .map((x) => ({ title: x.title, hook: stripHTML(x.snippet).replace(/\s+/g, ' ').trim().slice(0, 140) + '…' }));
    if (ideas.length) return ideas;
  } catch (e) { /* fall through */ }
  return EVERGREEN.slice(0, count).map(([title, hook]) => ({ title, hook }));
}

function cleanSentence(s) {
  return s.replace(/\s*\([^()]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').replace(/\s+/g, ' ').replace(/\s([,.;:])/g, '$1').trim();
}
function splitSentences(text) {
  return text.replace(/\n+/g, ' ').split(/(?<=[.!?।。])\s+(?=[A-Z0-9"“‘'\u0900-\u097F\u0600-\u06FF\u3040-\u9fff\u0400-\u04FF]|$)/u)
    .map(cleanSentence).filter((s) => s.length > 25 && s.length < 320 && !/^(See also|References|External links)/i.test(s));
}

const OUTRO = {
  en: (t) => `That's the story of ${t}. Follow for more stories like this.`,
  hi: (t) => `यह थी ${t} की कहानी। ऐसी और कहानियों के लिए फ़ॉलो करें।`,
  es: (t) => `Esa es la historia de ${t}. Síguenos para más historias como esta.`,
  fr: (t) => `Voilà l'histoire de ${t}. Abonne-toi pour plus d'histoires comme celle-ci.`,
  de: (t) => `Das war die Geschichte von ${t}. Folge für mehr Geschichten wie diese.`,
  pt: (t) => `Essa é a história de ${t}. Siga para mais histórias assim.`,
};
const HOOK = {
  en: (t) => `This is ${t}, and the real story is stranger than you think.`,
  hi: (t) => `यह है ${t}, और असली कहानी आपकी सोच से कहीं ज़्यादा दिलचस्प है।`,
  es: (t) => `Esto es ${t}, y la historia real es más extraña de lo que crees.`,
  fr: (t) => `Voici ${t}, et la vraie histoire est plus étrange qu'on ne le croit.`,
  de: (t) => `Das ist ${t}, und die wahre Geschichte ist seltsamer, als du denkst.`,
  pt: (t) => `Isto é ${t}, e a história real é mais estranha do que você imagina.`,
};

function headline(sentence, max = 5) {
  const words = sentence.replace(/[“”"]/g, '').split(/\s+/);
  let cut = words.slice(0, max).join(' ');
  return cut.replace(/[,;:.]+$/, '') + (words.length > max ? '…' : '');
}

export async function freeScript({ topic, lengthSec, language, format }) {
  const lang = wikiLang(language);
  const targetWords = Math.round(lengthSec * 2.4);
  let title = topic.trim();
  let sentences = [];
  let source = null;
  try {
    const s = await wikiAPI(lang, { action: 'query', list: 'search', srsearch: topic, srlimit: '1' });
    const hit = s.query && s.query.search && s.query.search[0];
    if (hit) {
      const j = await wikiAPI(lang, { action: 'query', prop: 'extracts', explaintext: '1', exsectionformat: 'plain', redirects: '1', titles: hit.title });
      const page = Object.values((j.query && j.query.pages) || {})[0];
      if (page && page.extract) {
        title = page.title;
        sentences = splitSentences(page.extract);
        source = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`;
      }
    }
  } catch (e) { /* fallback below */ }

  const scenes = [];
  const hook = (HOOK[lang] || HOOK.en)(title);
  scenes.push({ narration: hook, visual: title });
  if (sentences.length >= 3) {
    let words = hook.split(/\s+/).length;
    const perScene = format === '9:16' ? 1 : 2;
    for (let i = 0; i < sentences.length && words < targetWords; i += perScene) {
      const chunk = sentences.slice(i, i + perScene).join(' ');
      words += chunk.split(/\s+/).length;
      scenes.push({ narration: chunk, visual: headline(sentences[i]) });
    }
  } else {
    // Template writer: never leaves the user with nothing.
    const t = title;
    [
      `${t} is one of those subjects that sounds simple, until you look closer.`,
      `To understand ${t}, you have to start with where it all began.`,
      `Over time, the story of ${t} grew bigger than anyone expected.`,
      `There are a few facts about ${t} that most people never hear.`,
      `And that's why ${t} still gets people talking today.`,
    ].forEach((n) => scenes.push({ narration: n, visual: headline(n, 5) }));
  }
  scenes.push({ narration: (OUTRO[lang] || OUTRO.en)(title), visual: lang === 'en' ? 'Follow for more' : title });
  return { title, scenes, source, fromWikipedia: sentences.length >= 3 };
}

// ---------- on-device voice (Kokoro) ----------
export const FREE_VOICES = [
  ['am_michael', 'Michael · US male, warm narrator'], ['am_fenrir', 'Fenrir · US male, deep'], ['am_onyx', 'Onyx · US male, low'],
  ['am_adam', 'Adam · US male'], ['am_eric', 'Eric · US male'], ['am_liam', 'Liam · US male'], ['am_puck', 'Puck · US male, lively'],
  ['af_heart', 'Heart · US female, warm'], ['af_bella', 'Bella · US female, bright'], ['af_nicole', 'Nicole · US female, soft'],
  ['af_sarah', 'Sarah · US female'], ['af_nova', 'Nova · US female'], ['af_sky', 'Sky · US female'], ['af_river', 'River · US female'],
  ['bm_george', 'George · UK male, documentary'], ['bm_lewis', 'Lewis · UK male'], ['bm_daniel', 'Daniel · UK male'], ['bm_fable', 'Fable · UK male'],
  ['bf_emma', 'Emma · UK female'], ['bf_isabella', 'Isabella · UK female'], ['bf_alice', 'Alice · UK female'], ['bf_lily', 'Lily · UK female'],
].map(([id, name]) => ({ id, name }));

let worker = null;
let seq = 0;
const pending = new Map();
let progressCb = null;
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./tts-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') { progressCb && progressCb(m.value); return; }
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id);
      if (m.type === 'done') p.resolve(m.blob);
      else p.reject(new Error('The free voice could not run on this device (' + m.message + '). You can upload your own recording instead.'));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error('The free voice could not load on this device. You can upload your own recording instead.'));
      pending.clear(); worker = null;
    };
  }
  return worker;
}

let queue = Promise.resolve();
export function freeSpeak(text, voiceId, onProgress) {
  // One generation at a time: the model runs on this device's CPU, in a background thread.
  const run = () => new Promise((resolve, reject) => {
    progressCb = onProgress;
    const id = ++seq;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, text: text.slice(0, 1200), voice: voiceId || 'am_michael' });
  });
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
