import { applyBrand, siteSettings, settingsReady } from './brand.js';
import { BRAND, SIGNIN_LOG_URL, SIGNIN_NOTICE } from './config.js';
import * as store from './store.js';
import * as ai from './ai.js';
import { AssetBank, buildTimeline, drawFrame, drawCard, mixAudio, sceneAt, videosAt, canvasSize, SAMPLE_RATE } from './engine.js';
import { exportVideo } from './exporter.js';
import { mountBanner } from './banner.js?v=1.3.4';
import * as free from './free.js';

applyBrand();

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const fmtTime = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3500);
}
function modal(html, bind) {
  $('#modal').innerHTML = html; $('#modalBg').classList.add('open');
  const close = () => $('#modalBg').classList.remove('open');
  $$('[data-close]', $('#modal')).forEach((b) => b.onclick = close);
  bind && bind($('#modal'), close);
  return close;
}
function confirmBox(title, text, okLabel = 'OK') {
  return new Promise((resolve) => {
    modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="acts"><button class="btn" data-close>Cancel</button><button class="btn primary" id="mOk">${esc(okLabel)}</button></div>`,
      (m, close) => { $('#mOk', m).onclick = () => { close(); resolve(true); }; $('[data-close]', m).addEventListener('click', () => resolve(false)); });
  });
}
async function pool(items, n, fn) {
  const queue = [...items]; const errors = [];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) { const it = queue.shift(); try { await fn(it); } catch (e) { errors.push(e); } }
  }));
  return errors;
}
// Like pool(), but stops starting new AI calls after the first "out of credits" error.
// Returns { errors, failed, skipped, creditsHit }.
async function aiPool(items, n, fn) {
  const queue = [...items]; const errors = []; const failed = []; let creditsHit = false;
  // The first call runs alone, so an empty account costs one refused call, not a burst.
  if (queue.length) {
    const first = queue.shift();
    try { await fn(first); } catch (e) { errors.push(e); failed.push(first); if (ai.isCreditsError(e)) { creditsHit = true; markCreditsOut(); } }
  }
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length && !creditsHit) {
      const it = queue.shift();
      try { await fn(it); } catch (e) {
        errors.push(e); failed.push(it);
        if (ai.isCreditsError(e)) { creditsHit = true; markCreditsOut(); }
      }
    }
  }));
  return { errors, failed, skipped: queue.splice(0), creditsHit };
}
function pickFile(accept) {
  return new Promise((resolve) => {
    const fp = $('#filePicker'); fp.value = ''; fp.accept = accept;
    fp.onchange = () => resolve(fp.files[0] || null);
    fp.click();
  });
}

// ---------- state ----------
const TONES = ['Documentary', 'Educational', 'Storytelling', 'Mysterious', 'Energetic', 'Funny', 'Calm'];
const LENGTHS = [[30, '30s'], [60, '60s'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [480, '8 min']];
const STEPS = ['Topic', 'Script', 'Visuals', 'Voice', 'Edit & Export'];

let project = null;
let step = 0;
let bank = new AssetBank();
const busy = new Map();         // sceneId -> label
const thumbs = new Map();       // blob key -> object URL
let signedIn = false;

function newProject() {
  return {
    id: uid(), name: 'Untitled video', createdAt: Date.now(), updatedAt: Date.now(),
    topic: '', niche: '', ideas: [], format: '16:9', lengthSec: 60, tone: 'Documentary', language: 'en-US', extra: '',
    title: '', scenes: [], style: 'cinematic', imageModel: ai.IMAGE_MODELS[0].id,
    mode: null, // null = Free when signed out, AI when signed in; set once the user picks
    voice: signedIn ? { provider: 'aws-polly', voice: 'Matthew', engine: 'neural', language: 'en-US' } : { provider: 'kokoro', voice: 'am_michael', engine: '', language: 'en-US' },
    captions: { enabled: true, style: 'bold' }, transition: 'crossfade', kenBurns: true, fadeInOut: true,
    music: null, exportHeight: 1080, step: 0,
  };
}
function newScene(narration = '', visual = '') { return { id: uid(), narration, visual, caption: '', imageKey: null, videoKey: null, useVideo: true, audioKey: null, audioDur: 0, audioText: '' }; }

let saveTimer = null;
function save(now = false) {
  $('#saveState').textContent = 'Saving…';
  clearTimeout(saveTimer);
  const run = async () => { project.step = step; await store.saveProject(project); await store.kvSet('lastProject', project.id); $('#saveState').textContent = 'Saved'; };
  if (now) return run();
  saveTimer = setTimeout(run, 400);
}
function touched() { invalidatePreview(); save(); }

async function thumbURL(key) {
  if (!key) return null;
  if (thumbs.has(key)) return thumbs.get(key);
  const b = await store.getBlob(key); if (!b) return null;
  const u = URL.createObjectURL(b); thumbs.set(key, u); return u;
}
async function replaceBlob(scene, field, blob, kind) {
  const old = scene[field];
  const key = `${project.id}/${scene.id}/${kind}-${uid()}`;
  await store.putBlob(key, blob);
  scene[field] = key;
  if (old) { store.deleteBlob(old); bank.forget(old); if (thumbs.has(old)) { URL.revokeObjectURL(thumbs.get(old)); thumbs.delete(old); } }
  return key;
}
function audioDuration(blob) {
  return new Promise(async (resolve) => {
    try {
      const ac = new OfflineAudioContext(1, 1, SAMPLE_RATE);
      const buf = await ac.decodeAudioData(await blob.arrayBuffer());
      resolve(buf.duration);
    } catch (e) {
      const a = new Audio(); a.src = URL.createObjectURL(blob);
      a.onloadedmetadata = () => resolve(isFinite(a.duration) ? a.duration : 0); a.onerror = () => resolve(0);
    }
  });
}

// ---------- mode: Free (no sign-in, no credits) or AI (Puter) ----------
const isFree = () => (project.mode ? project.mode === 'free' : (!signedIn || creditsOut));
function setMode(m) {
  project.mode = m;
  if (m === 'free' && project.voice.provider !== 'kokoro') project.voice = { provider: 'kokoro', voice: 'am_michael', engine: '', language: project.language };
  renderMode(); save(); renderPane();
}
function renderMode() {
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.v === 'free') === isFree()));
  const hint = $('#modeHint');
  if (hint) hint.textContent = isFree() ? 'No sign-in, no credits. Works even when signed in.' : 'Uses your Puter account\'s AI credits.';
  renderCreditsBanner();
}

// ---------- out of Puter credits ----------
// Remembered for the current month in this browser, so the app stops firing calls that will fail.
const CREDITS_KEY = 'ck-credits-out';
const monthTag = () => new Date().toISOString().slice(0, 7);
let creditsOut = (() => { try { return localStorage.getItem(CREDITS_KEY) === monthTag(); } catch (e) { return false; } })();
function markCreditsOut() {
  creditsOut = true;
  try { localStorage.setItem(CREDITS_KEY, monthTag()); } catch (e) {}
  renderCreditsBanner();
}
function clearCreditsOut() {
  creditsOut = false;
  try { localStorage.removeItem(CREDITS_KEY); } catch (e) {}
  renderCreditsBanner();
}
function renderCreditsBanner() {
  const el = $('#creditsBanner'); if (!el) return;
  const show = creditsOut && project && !isFree();
  el.hidden = !show;
  if (!show) return;
  el.innerHTML = `<div class="cb-text"><b>Your Puter AI credits are used up.</b> Scenes without an AI image use free title cards, so your video still works.</div>
    <div class="cb-acts"><button class="btn sm primary" id="cbFree">Use Free mode (no credits)</button><button class="btn sm ghost" id="cbRetry" title="Only if you have added credits">I added credits</button></div>`;
  $('#cbFree', el).onclick = () => { setMode('free'); toast('Free mode: no sign-in, no credits.', 'ok'); };
  $('#cbRetry', el).onclick = () => { clearCreditsOut(); toast('OK, AI calls are back on.'); };
}
$$('#modeSeg button').forEach((b) => b.onclick = async () => {
  if (b.dataset.v === 'ai' && !(await ensureAuth())) return;
  setMode(b.dataset.v);
  toast(b.dataset.v === 'free' ? 'Free mode: no sign-in, no credits.' : 'AI mode: AI script, images and voices on your Puter account.');
});
function handleAIError(e) {
  const code = e && (e.code || e.error);
  const msg = (e && (e.message || e.msg)) || String(e);
  if (ai.isCreditsError(e) || /credit|funds/i.test(msg)) {
    markCreditsOut();
    if (isFree()) return;
    modal(`<h3>Your Puter credits are used up</h3><p>Your free AI credits for this month have run out. Everything you've made so far is saved. Switch to Free mode to keep going: title cards, a free on-device voice and a script from Wikipedia, with no credits needed.</p>
      <div class="acts"><button class="btn" data-close>Not now</button><button class="btn primary" id="mFree">Switch to Free mode</button></div>`,
    (m, close) => { $('#mFree', m).onclick = () => { close(); setMode('free'); }; });
    return;
  }
  if (code === 'auth_window_closed' || /not.*signed|unauthori|401|token/i.test(msg)) { toast('Sign in to Puter first, or switch to Free mode (top bar).', 'err'); return; }
  toast(ai.friendlyError(e), 'err');
}

// ---------- account ----------
async function refreshAccount() {
  try {
    signedIn = await ai.isSignedIn();
    const u = signedIn ? await ai.getUser() : null;
    $('#acctDot').classList.toggle('on', signedIn);
    $('#acctWho').textContent = signedIn ? (u && u.username ? u.username : 'Signed in') : 'Not signed in';
    $('#btnSignIn').textContent = signedIn ? 'Sign out' : 'Sign in';
    if (project) { renderMode(); }
  } catch (e) { $('#acctWho').textContent = 'AI offline'; }
}
async function ensureAuth() {
  if (await ai.isSignedIn()) return true;
  try { await ai.signIn(); await refreshAccount(); if (SIGNIN_LOG_URL) toast(SIGNIN_NOTICE); return true; }
  catch (e) { toast(ai.friendlyError(e) + ' You can also use Free mode (top bar), no sign-in needed.', 'err'); return false; }
}
$('#btnSignIn').onclick = async () => {
  if (signedIn) { await ai.signOut(); await refreshAccount(); toast('Signed out'); return; }
  if (await ensureAuth()) toast(`Signed in. AI usage runs on your own free account.${SIGNIN_LOG_URL ? ' ' + SIGNIN_NOTICE : ''}`, 'ok');
};

// ---------- stepper ----------
function stepDone(i) {
  const s = project.scenes;
  if (i === 0) return !!project.topic;
  if (i === 1) return s.length > 0;
  if (i === 2) return s.length > 0 && (isFree() || creditsOut || s.every((x) => x.imageKey || x.videoKey));
  if (i === 3) return s.length > 0 && s.every((x) => x.audioKey);
  return false;
}
function renderStepper() {
  $$('#stepper button').forEach((b) => {
    const i = +b.dataset.step;
    b.classList.toggle('active', i === step);
    b.classList.toggle('done', i !== step && stepDone(i));
    b.onclick = () => go(i);
  });
  $('#btnMobilePrev').disabled = step === 0;
  $('#btnMobileNext').textContent = step === 4 ? 'Export' : `Next: ${STEPS[step + 1]}`;
}
function go(i) {
  step = Math.max(0, Math.min(4, i));
  document.body.classList.remove('show-preview');
  renderStepper(); renderPane(); save();
  $('#pane').scrollTop = 0;
}
$('#btnMobilePrev').onclick = () => go(step - 1);
$('#btnMobileNext').onclick = () => { if (step === 4) $('#btnExport') && $('#btnExport').click(); else go(step + 1); };
$('#btnMobilePreview').onclick = () => { document.body.classList.add('show-preview'); refreshPreview(); };
$('#btnBackEdit').onclick = () => { stopPlayback(); document.body.classList.remove('show-preview'); };

function renderPane() {
  const pane = $('#pane');
  [renderTopic, renderScript, renderVisuals, renderVoice, renderExport][step](pane);
}
function nextRow(prevLabel, nextLabel, nextFn, extra = '') {
  return `<div class="next-row">${step > 0 ? `<button class="btn" id="goPrev">← ${esc(prevLabel)}</button>` : '<span></span>'}${extra}${nextLabel ? `<button class="btn primary" id="goNext">${esc(nextLabel)} →</button>` : ''}</div>`;
}
function bindNext(pane, nextFn) {
  const p = $('#goPrev', pane); if (p) p.onclick = () => go(step - 1);
  const n = $('#goNext', pane); if (n) n.onclick = nextFn || (() => go(step + 1));
}

// ---------- step 1: topic ----------
function modeNotice() {
  return isFree()
    ? `<div class="notice" style="margin-bottom:14px"><b>Free mode</b>: no sign-in, no credits. The script is built from Wikipedia facts, scenes are animated title cards (or your own uploads) and the voice is generated on your device. <a href="#" data-mode="ai" style="color:var(--text)">Switch to AI mode</a> for AI-written scripts, AI images and voices in any language.</div>`
    : `<div class="notice" style="margin-bottom:14px"><b>AI mode</b>: uses your Puter account's free monthly AI credits. <a href="#" data-mode="free" style="color:var(--text)">Switch to Free mode</a> any time; your project stays as it is.</div>`;
}
function bindModeLinks(root) {
  $$('[data-mode]', root).forEach((l) => l.onclick = async (e) => { e.preventDefault(); if (l.dataset.mode === 'ai' && !(await ensureAuth())) return; setMode(l.dataset.mode); });
}
function renderTopic(pane) {
  const p = project;
  pane.innerHTML = `
  <div class="panel-title"><div><h2>What's your video about?</h2><p>Type a topic, or get ideas that people will click.</p></div></div>
  ${modeNotice()}
  <div class="card">
    <div class="field"><label for="topic">Video topic</label>
      <input type="text" id="topic" placeholder="e.g. The ghost ship that sailed with no crew" value="${esc(p.topic)}"></div>
    <div class="row">
      <div class="field" style="flex:3 1 220px"><label for="niche">Need ideas? Your niche or keywords</label>
        <input type="text" id="niche" placeholder="e.g. unsolved mysteries, space, personal finance" value="${esc(p.niche)}"></div>
      <div class="field" style="flex:0 0 auto"><button class="btn" id="btnIdeas">✨ Suggest topics</button></div>
    </div>
    <div class="ideas" id="ideas">${(p.ideas || []).map((x, i) => `<button class="idea ${p.topic === x.title ? 'on' : ''}" data-i="${i}"><b>${esc(x.title)}</b><span>${esc(x.hook)}</span></button>`).join('')}</div>
  </div>
  <div class="card">
    <h3>Format</h3>
    <div class="seg" id="fmt"><button data-v="16:9" class="${p.format === '16:9' ? 'on' : ''}">16:9 · YouTube</button><button data-v="9:16" class="${p.format === '9:16' ? 'on' : ''}">9:16 · Shorts / Reels</button></div>
    <h3 style="margin-top:16px">Length</h3>
    <div class="chips" id="len">${LENGTHS.map(([v, l]) => `<button class="chip ${p.lengthSec === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
    <h3 style="margin-top:16px">Tone</h3>
    <div class="chips" id="tone">${TONES.map((t) => `<button class="chip ${p.tone === t ? 'on' : ''}" data-v="${t}">${t}</button>`).join('')}</div>
    <div class="row" style="margin-top:16px">
      <div class="field"><label for="lang">Language</label><select id="lang">${ai.LANGUAGES.map((l) => `<option value="${l.code}" ${p.language === l.code ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label for="extra">Extra instructions (optional)</label>
      <textarea id="extra" rows="2" placeholder="e.g. mention 3 surprising facts, end with a question for the comments">${esc(p.extra)}</textarea></div>
  </div>
  ${p.scenes.length ? `<div class="notice warn" style="margin-bottom:14px">This project already has a script. Writing a new one replaces it.</div>` : ''}
  <div class="next-row"><span></span><div class="row">${p.scenes.length ? '<button class="btn" id="goNextKeep">Keep current script →</button>' : ''}<button class="btn primary" id="btnWrite">✍️ Write my script</button></div></div>`;

  $('#topic', pane).oninput = (e) => { p.topic = e.target.value; if (!p.title && p.name === 'Untitled video') { } save(); };
  $('#niche', pane).oninput = (e) => { p.niche = e.target.value; save(); };
  $('#extra', pane).oninput = (e) => { p.extra = e.target.value; save(); };
  $('#lang', pane).onchange = (e) => { p.language = e.target.value; if (p.voice.provider === 'aws-polly') { p.voice.language = p.language; p.voice.voice = ''; } save(); };
  $$('#fmt button', pane).forEach((b) => b.onclick = () => { p.format = b.dataset.v; touched(); renderTopic(pane); setupPlayer(); });
  $$('#len button', pane).forEach((b) => b.onclick = () => { p.lengthSec = +b.dataset.v; save(); renderTopic(pane); });
  $$('#tone button', pane).forEach((b) => b.onclick = () => { p.tone = b.dataset.v; save(); renderTopic(pane); });
  $$('#ideas .idea', pane).forEach((b) => b.onclick = () => { p.topic = p.ideas[+b.dataset.i].title; save(); renderTopic(pane); });
  const keep = $('#goNextKeep', pane); if (keep) keep.onclick = () => go(1);
  bindModeLinks(pane);
  $('#btnIdeas', pane).onclick = async (e) => {
    const btn = e.currentTarget;
    if (!isFree() && !(await ensureAuth())) return;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Thinking…';
    try { p.ideas = isFree() ? await free.freeTopicIdeas({ niche: p.niche, language: p.language }) : await ai.topicIdeas({ niche: p.niche, language: p.language, format: p.format }); save(); renderTopic(pane); }
    catch (err) { handleAIError(err); btn.disabled = false; btn.textContent = '✨ Suggest topics'; }
  };
  $('#btnWrite', pane).onclick = async (e) => {
    if (!p.topic.trim()) { toast('Type a topic or pick an idea first.', 'err'); $('#topic', pane).focus(); return; }
    if (p.scenes.length && !(await confirmBox('Replace the script?', 'Writing a new script replaces the current scenes, images and voiceover.', 'Replace'))) return;
    const btn = e.currentTarget;
    if (!isFree() && !(await ensureAuth())) return;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing…';
    try {
      const s = isFree() ? await free.freeScript({ topic: p.topic, lengthSec: p.lengthSec, language: p.language, format: p.format })
        : await ai.writeScript({ topic: p.topic, lengthSec: p.lengthSec, tone: p.tone, language: p.language, format: p.format, extra: p.extra });
      p.source = s.source || null;
      if (isFree() && !s.fromWikipedia) toast('No Wikipedia article found for that topic, so this is a starter script. Edit the lines to make it yours.');
      for (const sc of p.scenes) { for (const k of [sc.imageKey, sc.videoKey, sc.audioKey]) if (k) store.deleteBlob(k); }
      p.title = s.title; p.name = s.title; $('#projName').value = s.title;
      p.scenes = s.scenes.map((x) => newScene(x.narration, x.visual));
      touched(); go(1);
      toast(`Script ready: ${p.scenes.length} scenes`, 'ok');
    } catch (err) { handleAIError(err); btn.disabled = false; btn.textContent = '✍️ Write my script'; }
  };
}

// ---------- step 2: script ----------
function renderScript(pane) {
  const p = project;
  const words = p.scenes.reduce((a, s) => a + (s.narration || '').split(/\s+/).filter(Boolean).length, 0);
  pane.innerHTML = `
  <div class="panel-title"><div><h2>Script</h2><p>${p.source ? `Built from <a href="${esc(p.source)}" target="_blank" rel="noopener" style="color:var(--text)">Wikipedia</a> (check facts before publishing). ` : ''}${p.scenes.length} scenes · ~${words} words · ~${fmtTime(buildTimeline(p).duration)}. Edit anything; each scene becomes one shot.</p></div>
    <button class="btn sm" id="btnAddTop">+ Scene</button></div>
  ${p.scenes.length ? '' : `<div class="card empty-state">No script yet. Go to <b>Topic</b> and press “Write my script”, or add scenes by hand.<br><br><button class="btn primary" id="btnAddEmpty">+ Add a scene</button></div>`}
  <div id="scenes">${p.scenes.map((s, i) => `
    <div class="scene" data-id="${s.id}">
      <div class="idx">${i + 1}</div>
      <div>
        <div class="scene-head"><span class="meta">${s.audioKey && s.audioText !== s.narration ? '⚠︎ voiceover out of date' : ''}</span>
          <div class="tools">
            <button class="btn icon ghost" data-a="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn icon ghost" data-a="down" title="Move down" ${i === p.scenes.length - 1 ? 'disabled' : ''}>↓</button>
            ${isFree() ? '' : '<button class="btn icon ghost" data-a="rewrite" title="Rewrite with AI">✨</button>'}
            <button class="btn icon ghost danger" data-a="del" title="Delete scene">✕</button>
          </div></div>
        <div class="field"><label>Narration</label><textarea data-f="narration" rows="3">${esc(s.narration)}</textarea></div>
        <div class="field" style="margin:0"><label>${isFree() && !s.imageKey ? 'Title card text' : 'Image idea'}</label><textarea data-f="visual" rows="2">${esc(s.visual)}</textarea></div>
      </div>
    </div>`).join('')}</div>
  ${p.scenes.length ? '<button class="btn" id="btnAdd">+ Add scene</button>' : ''}
  ${nextRow('Topic', 'Visuals')}`;
  const add = () => { p.scenes.push(newScene('', '')); touched(); renderScript(pane); };
  ['#btnAdd', '#btnAddTop', '#btnAddEmpty'].forEach((s) => { const b = $(s, pane); if (b) b.onclick = add; });
  $$('.scene', pane).forEach((el) => {
    const s = p.scenes.find((x) => x.id === el.dataset.id);
    $$('textarea', el).forEach((ta) => ta.oninput = () => { s[ta.dataset.f] = ta.value; touched(); });
    $$('[data-a]', el).forEach((b) => b.onclick = async () => {
      const i = p.scenes.indexOf(s); const a = b.dataset.a;
      if (a === 'up' || a === 'down') { const j = a === 'up' ? i - 1 : i + 1; [p.scenes[i], p.scenes[j]] = [p.scenes[j], p.scenes[i]]; touched(); renderScript(pane); }
      if (a === 'del') { if (await confirmBox('Delete this scene?', 'Its image and voiceover are removed too.', 'Delete')) { for (const k of [s.imageKey, s.videoKey, s.audioKey]) if (k) store.deleteBlob(k); p.scenes.splice(i, 1); touched(); renderScript(pane); } }
      if (a === 'rewrite') {
        if (!(await ensureAuth())) return;
        b.innerHTML = '<span class="spinner"></span>';
        try { s.narration = await ai.rewriteScene({ narration: s.narration, topic: p.topic, language: p.language }); touched(); renderScript(pane); }
        catch (e) { handleAIError(e); b.textContent = '✨'; }
      }
    });
  });
  bindNext(pane);
}

// ---------- one voiceover file for the whole video ----------
// Splits the recording into one clip per scene: the cut points start where each scene's share of the
// script text would end, then move to the quietest moment nearby so words aren't cut in half.
function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2); const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}
async function splitVoiceover(file) {
  const ac = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const ab = await ac.decodeAudioData(await file.arrayBuffer());
  const rate = ab.sampleRate; const len = ab.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ab.numberOfChannels; }
  const scenes = project.scenes; const n = scenes.length;
  const weights = scenes.map((s) => Math.max(1, (s.narration || '').trim().length));
  const total = weights.reduce((a, b) => a + b, 0);
  // loudness per 20 ms window
  const win = Math.round(rate * 0.02); const rms = new Float32Array(Math.ceil(len / win));
  for (let w = 0; w < rms.length; w++) { let e = 0; const a = w * win, z = Math.min(len, a + win); for (let i = a; i < z; i++) e += mono[i] * mono[i]; rms[w] = e / Math.max(1, z - a); }
  const cuts = [0]; let acc = 0;
  const reach = Math.max(5, Math.min(75, Math.round((len / n / rate) * 0.35 / 0.02))); // search radius in windows
  for (let i = 0; i < n - 1; i++) {
    acc += weights[i];
    const target = Math.round((acc / total) * rms.length);
    let best = target, bestE = Infinity;
    const lo = Math.max(Math.ceil(cuts[cuts.length - 1] / win) + 1, target - reach), hi = Math.min(rms.length - 2, target + reach);
    for (let w = lo; w <= hi; w++) { const e = rms[w] + rms[w + 1] * 0.5 + (rms[w - 1] || 0) * 0.5 + Math.abs(w - target) * 1e-7; if (e < bestE) { bestE = e; best = w; } }
    cuts.push(Math.min(len, Math.max(cuts[cuts.length - 1] + win, best * win)));
  }
  cuts.push(len);
  for (let i = 0; i < n; i++) {
    const s = scenes[i];
    const part = mono.subarray(cuts[i], cuts[i + 1]);
    const blob = encodeWav(part, rate);
    await replaceBlob(s, 'audioKey', blob, 'vo');
    s.audioDur = part.length / rate; s.audioText = s.narration;
  }
  touched();
  return n;
}

// ---------- step 3: visuals ----------
async function genImage(s) {
  busy.set(s.id, 'Generating image…'); refreshVisualCard(s);
  try {
    const blob = await ai.generateImage(s.visual || s.narration, { model: project.imageModel, format: project.format, style: project.style });
    await replaceBlob(s, 'imageKey', blob, 'img');
    save();
  } finally { busy.delete(s.id); refreshVisualCard(s); invalidatePreview(); renderStepper(); }
}
async function genClip(s) {
  busy.set(s.id, 'Animating clip… this can take a few minutes'); refreshVisualCard(s);
  try {
    let ref = s.imageKey ? await store.getBlob(s.imageKey) : null;
    if (!ref) { await genImage(s); ref = await store.getBlob(s.imageKey); busy.set(s.id, 'Animating clip… this can take a few minutes'); refreshVisualCard(s); }
    const blob = await ai.generateVideoClip(s.visual || s.narration, ref, { format: project.format });
    await replaceBlob(s, 'videoKey', blob, 'vid'); s.useVideo = true; s.videoMine = false; save();
  } finally { busy.delete(s.id); refreshVisualCard(s); invalidatePreview(); }
}
function visualCardHTML(s, i) {
  const r = project.format === '9:16' ? 'r916' : 'r169';
  const b = busy.get(s.id);
  const freeMode = isFree();
  return `<div class="thumb ${r}">${s.videoKey && s.useVideo !== false ? `<video data-key="${s.videoKey}" muted loop playsinline autoplay></video>` : s.imageKey ? `<img data-key="${s.imageKey}" alt="">` : `<canvas data-card="${s.id}" width="${project.format === '9:16' ? 270 : 480}" height="${project.format === '9:16' ? 480 : 270}" style="width:100%;height:100%"></canvas>`}
      <span class="badge">${i + 1}</span>${s.videoKey ? `<span class="badge vid">${s.useVideo !== false ? (s.videoMine ? 'Your clip' : 'AI clip') : 'clip off'}</span>` : ''}
      ${b ? `<div class="busy-overlay"><div class="spinner"></div>${esc(b)}</div>` : ''}</div>
    <div class="body"><p title="${esc(s.visual)}">${esc(s.visual || s.narration)}</p>
      <div class="acts">
        ${freeMode ? `<button class="btn sm" data-a="upload" ${b ? 'disabled' : ''}>⬆ Upload photo/video</button>
        <button class="btn sm ghost" data-a="edit" title="Edit the title card text">✎ Card text</button>
        ${s.imageKey || s.videoKey ? '<button class="btn sm ghost danger" data-a="clear">Use title card</button>' : ''}` : `
        <button class="btn sm" data-a="img" ${b ? 'disabled' : ''}>${s.imageKey ? '↻ New image' : '✨ Image'}</button>
        ${siteSettings().enableVideo === false ? '' : `<button class="btn sm" data-a="clip" ${b ? 'disabled' : ''} title="Turn this image into a 5-second AI video clip">🎬 ${s.videoKey ? 'New clip' : 'AI clip'}</button>`}
        ${s.videoKey ? `<button class="btn sm" data-a="toggle">${s.useVideo !== false ? 'Use image' : 'Use clip'}</button>` : ''}
        <button class="btn sm" data-a="upload" ${b ? 'disabled' : ''} title="Upload your own photo or video clip">⬆ Upload photo/video</button>
        <button class="btn sm ghost" data-a="edit" title="Edit the image idea">✎</button>`}
      </div></div>`;
}
function drawCardThumbs(root) {
  $$('canvas[data-card]', root).forEach((c) => {
    const i = project.scenes.findIndex((x) => x.id === c.dataset.card); if (i < 0) return;
    drawCard(c.getContext('2d'), c.width, c.height, { index: i, scene: project.scenes[i] }, 3, project);
  });
}
async function hydrateThumbs(root) {
  drawCardThumbs(root);
  for (const el of $$('[data-key]', root)) { const u = await thumbURL(el.dataset.key); if (u && el.src !== u) el.src = u; }
}
function refreshVisualCard(s) {
  const card = $(`.vis[data-id="${s.id}"]`);
  if (!card) return;
  card.innerHTML = visualCardHTML(s, project.scenes.indexOf(s));
  bindVisualCard(card, s); hydrateThumbs(card);
}
function bindVisualCard(card, s) {
  $$('[data-a]', card).forEach((b) => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'img') { if (!(await ensureAuth())) return; genImage(s).catch((e) => handleAIError(e)); }
    if (a === 'clip') {
      if (!(await ensureAuth())) return;
      if (!(await confirmBox('Make an AI video clip?', 'Turns this scene into a 5-second animated clip. Warning: video uses far more AI credit than images. A free Puter account can run out after about 3 clips. It can also take a few minutes.', 'Make clip'))) return;
      genClip(s).catch((e) => handleAIError(e));
    }
    if (a === 'toggle') { s.useVideo = s.useVideo === false; touched(); refreshVisualCard(s); }
    if (a === 'clear') { for (const k of [s.imageKey, s.videoKey]) if (k) { store.deleteBlob(k); bank.forget(k); } s.imageKey = null; s.videoKey = null; touched(); refreshVisualCard(s); }
    if (a === 'upload') {
      const f = await pickFile('image/*,video/*'); if (!f) return;
      if (f.type.startsWith('video/')) { await replaceBlob(s, 'videoKey', f, 'vid'); s.useVideo = true; s.videoMine = true; }
      else { await replaceBlob(s, 'imageKey', f, 'img'); s.useVideo = false; }
      touched(); refreshVisualCard(s); renderStepper();
    }
    if (a === 'edit') {
      const fm = isFree();
      modal(`<h3>${fm ? 'Title card text' : 'Image idea'} · scene ${project.scenes.indexOf(s) + 1}</h3><p>${fm ? 'A short headline shown on this scene\'s title card.' : 'Describe what the picture should show.'}</p><textarea id="mVis" rows="${fm ? 2 : 5}">${esc(s.visual)}</textarea>
        <div class="acts" style="margin-top:12px"><button class="btn" data-close>Cancel</button><button class="btn ${fm ? 'primary' : ''}" id="mSave">Save</button>${fm ? '' : '<button class="btn primary" id="mGen">Save &amp; generate</button>'}</div>`,
      (m, close) => {
        $('#mSave', m).onclick = () => { s.visual = $('#mVis', m).value; touched(); close(); refreshVisualCard(s); };
        if ($('#mGen', m)) $('#mGen', m).onclick = async () => { s.visual = $('#mVis', m).value; save(); close(); if (await ensureAuth()) genImage(s).catch((e) => handleAIError(e)); };
      });
    }
  });
}
function renderVisuals(pane) {
  const p = project;
  const missing = p.scenes.filter((s) => !s.imageKey && !s.videoKey).length;
  const fm = isFree();
  pane.innerHTML = `
  <div class="panel-title"><div><h2>Visuals</h2><p>${fm ? 'Every scene gets an animated title card automatically. Upload your own photo or video clip for any scene.' : 'AI makes one image per scene, or upload your own photo or video clip for any scene. AI video clips are optional, per scene, and use a lot of credits.'}</p></div></div>
  ${fm ? modeNotice() : ''}
  <div class="card" ${fm ? 'hidden' : ''}>
    <h3>Look</h3>
    <div class="chips" id="styles">${ai.STYLES.map((s) => `<button class="chip ${p.style === s.id ? 'on' : ''}" data-v="${s.id}">${s.label}</button>`).join('')}</div>
    <div class="row" style="margin-top:14px">
      <div class="field"><label for="imgModel">Image quality</label><select id="imgModel">${ai.IMAGE_MODELS.map((m) => `<option value="${esc(m.id)}" ${p.imageModel === m.id ? 'selected' : ''}>${esc(m.label)} · ${esc(m.note)}</option>`).join('')}</select></div>
      <div class="field" style="flex:0 0 auto"><button class="btn primary" id="btnGenAll" ${!p.scenes.length ? 'disabled' : ''}>${missing === 0 && p.scenes.length ? '✓ All images ready' : missing === p.scenes.length ? '✨ Generate all images' : `✨ Generate ${missing} missing`}</button></div>
      <div class="field" style="flex:0 0 auto"><button class="btn" id="btnRegenAll" ${!p.scenes.length ? 'disabled' : ''}>↻ Redo all</button></div>
    </div>
  </div>
  ${p.scenes.length ? '' : '<div class="card empty-state">Write a script first.</div>'}
  <div class="vis-grid" id="visGrid">${p.scenes.map((s, i) => `<div class="vis" data-id="${s.id}">${visualCardHTML(s, i)}</div>`).join('')}</div>
  ${nextRow('Script', 'Voice')}`;
  $$('#styles .chip', pane).forEach((b) => b.onclick = () => { p.style = b.dataset.v; save(); $$('#styles .chip', pane).forEach((x) => x.classList.toggle('on', x === b)); });
  $('#imgModel', pane).onchange = (e) => { p.imageModel = e.target.value; save(); };
  const runAll = async (list) => {
    if (!list.length) { toast('Every scene already has a visual.'); return; }
    if (creditsOut) { renderCreditsBanner(); toast('Your Puter credits are used up, so no AI images were requested. Scenes keep their free title cards.', 'err'); return; }
    if (!(await ensureAuth())) return;
    toast(`Generating ${list.length} image${list.length > 1 ? 's' : ''}…`);
    const r = await aiPool(list, 3, genImage);
    if (r.creditsHit) {
      const n = r.failed.length + r.skipped.length;
      toast(`Credits ran out. ${n} scene${n > 1 ? 's' : ''} use${n > 1 ? '' : 's'} free title cards instead.`, 'err');
    } else if (r.errors.length) { handleAIError(r.errors[0]); if (r.errors.length > 1) toast(`${r.errors.length} images failed.`, 'err'); }
    else toast('All images ready', 'ok');
    renderVisuals(pane);
  };
  $('#btnGenAll', pane).onclick = () => runAll(p.scenes.filter((s) => !s.imageKey && !s.videoKey && !busy.has(s.id)));
  $('#btnRegenAll', pane).onclick = async () => { if (await confirmBox('Regenerate every image?', 'This replaces all current images.', 'Regenerate')) runAll(p.scenes.filter((s) => !busy.has(s.id))); };
  $$('.vis', pane).forEach((card) => bindVisualCard(card, p.scenes.find((x) => x.id === card.dataset.id)));
  bindModeLinks(pane);
  hydrateThumbs(pane);
  bindNext(pane);
}

// ---------- step 4: voice ----------
function modelProgress(pr) {
  const el = $('#modelStatus'); if (!el) return;
  el.hidden = false;
  el.innerHTML = pr >= 1 ? 'Free voice model ready.' : `Downloading the free voice model (one time, ~90 MB)… ${Math.round(pr * 100)}%<div class="progress" style="margin-top:6px"><div style="width:${pr * 100}%"></div></div>`;
}
async function speakText(text) {
  const v = project.voice;
  if (v.provider === 'kokoro') return free.freeSpeak(text, v.voice, modelProgress);
  return ai.speak(text, v, { tone: project.tone });
}
async function genVoice(s) {
  busy.set(s.id, 'voice'); refreshVoiceRow(s);
  try {
    const text = (s.narration || '').trim(); if (!text) return;
    const blob = await speakText(text);
    await replaceBlob(s, 'audioKey', blob, 'vo');
    s.audioDur = await audioDuration(blob); s.audioText = s.narration; save();
  } finally { busy.delete(s.id); refreshVoiceRow(s); invalidatePreview(); renderStepper(); }
}
function voiceRowHTML(s, i) {
  const stale = s.audioKey && s.audioText !== s.narration;
  return `<div class="idx" style="width:26px;height:26px;border-radius:8px;background:var(--panel2);display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--muted)">${i + 1}</div>
    <div><p>${esc(s.narration)}</p><span class="dur">${busy.get(s.id) ? 'Generating…' : s.audioKey ? `${s.audioDur.toFixed(1)}s${stale ? ' · ⚠︎ text changed, regenerate' : ''}` : 'No voiceover yet'}</span></div>
    <div class="row" style="flex-wrap:nowrap;gap:4px">
      ${busy.get(s.id) ? '<span class="spinner"></span>' : `
      ${s.audioKey ? '<button class="btn icon ghost" data-a="play" title="Play">▶</button>' : ''}
      <button class="btn icon ghost" data-a="gen" title="${s.audioKey ? 'Regenerate' : 'Generate'}">${s.audioKey ? '↻' : '✨'}</button>
      <button class="btn icon ghost" data-a="upload" title="Upload your own recording">⬆</button>`}
    </div>`;
}
let rowAudio = null;
function refreshVoiceRow(s) {
  const row = $(`.vo-row[data-id="${s.id}"]`); if (!row) return;
  row.innerHTML = voiceRowHTML(s, project.scenes.indexOf(s)); bindVoiceRow(row, s);
}
function bindVoiceRow(row, s) {
  $$('[data-a]', row).forEach((b) => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === 'play') { if (rowAudio) rowAudio.pause(); rowAudio = new Audio(await thumbURL(s.audioKey)); rowAudio.play(); }
    if (a === 'gen') { if (project.voice.provider !== 'kokoro' && !(await ensureAuth())) return; genVoice(s).catch((e) => handleAIError(e)); }
    if (a === 'upload') {
      const f = await pickFile('audio/*'); if (!f) return;
      await replaceBlob(s, 'audioKey', f, 'vo'); s.audioDur = await audioDuration(f); s.audioText = s.narration; touched(); refreshVoiceRow(s); renderStepper();
    }
  });
}
async function fillVoices(pane) {
  const v = project.voice; const sel = $('#voiceSel', pane); const eng = $('#engineSel', pane);
  sel.innerHTML = '<option>Loading voices…</option>'; sel.disabled = true;
  try {
    let list = v.provider === 'kokoro' ? free.FREE_VOICES : await ai.listVoices(v.provider);
    if (v.provider === 'aws-polly') list = list.filter((x) => x.language && x.language.code === project.language);
    if (v.provider === 'kokoro' && !list.find((x) => x.id === v.voice)) { v.voice = 'am_michael'; save(); }
    if (!list.length) {
      sel.innerHTML = '<option value="">No standard voice for this language</option>';
      $('#voiceNote', pane).innerHTML = `<div class="notice warn">The Standard voices don't cover ${esc(ai.langName(project.language))}. Pick <b>Natural</b>, <b>Premium</b> or <b>Expressive</b>: they speak any language in your script.</div>`;
      return;
    }
    if (v.provider !== 'kokoro') $('#voiceNote', pane).innerHTML = '';
    if (!list.find((x) => x.id === v.voice)) { v.voice = (list.find((x) => (x.engines || []).includes('neural')) || list[0]).id; save(); }
    sel.innerHTML = list.map((x) => `<option value="${esc(x.id)}" ${x.id === v.voice ? 'selected' : ''}>${esc(x.name)}${x.description ? ' · ' + esc(String(x.description).slice(0, 40)) : ''}${x.labels && x.labels.gender ? ' · ' + esc(x.labels.gender) : ''}</option>`).join('');
    sel.disabled = false;
    if (v.provider === 'aws-polly' && eng) {
      const cur = list.find((x) => x.id === v.voice) || {};
      const engines = (cur.engines && cur.engines.length ? cur.engines : ['standard']).filter((e) => e !== 'long-form' || true);
      if (!engines.includes(v.engine)) { v.engine = engines.includes('neural') ? 'neural' : engines[0]; save(); }
      eng.innerHTML = engines.map((e) => `<option value="${e}" ${e === v.engine ? 'selected' : ''}>${e[0].toUpperCase() + e.slice(1)}</option>`).join('');
    }
  } catch (e) {
    sel.innerHTML = '<option value="">Sign in to load voices</option>';
    if (signedIn) handleAIError(e);
  }
}
function renderVoice(pane) {
  const p = project; const v = p.voice;
  const fm = isFree();
  if (fm && v.provider !== 'kokoro') { v.provider = 'kokoro'; v.voice = 'am_michael'; }
  const providers = ai.VOICE_PROVIDERS.filter((x) => !fm || x.free);
  if (v.provider === 'aws-polly') v.language = p.language;
  const missing = p.scenes.filter((s) => !s.audioKey || s.audioText !== s.narration).length;
  pane.innerHTML = `
  <div class="panel-title"><div><h2>Voiceover</h2><p>Pick a voice; each scene gets its own voice clip so the edit can time visuals and captions to it.</p></div></div>
  <div class="card">
    <h3>Voice type</h3>
    ${fm ? '' : ''}<div class="seg" id="prov">${providers.map((x) => `<button data-v="${x.id}" class="${v.provider === x.id ? 'on' : ''}">${x.label}</button>`).join('')}</div>
    <p class="hint" style="margin:8px 0 0">${esc((ai.VOICE_PROVIDERS.find((x) => x.id === v.provider) || {}).note || '')}</p>
    <div class="row" style="margin-top:14px">
      <div class="field"><label for="vlang">Language</label><select id="vlang">${ai.LANGUAGES.map((l) => `<option value="${l.code}" ${p.language === l.code ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="voiceSel">Voice</label><select id="voiceSel"></select></div>
      ${v.provider === 'aws-polly' ? '<div class="field" style="flex:0 1 140px"><label for="engineSel">Engine</label><select id="engineSel"></select></div>' : ''}
    </div>
    <div id="voiceNote">${v.provider === 'kokoro' && !p.language.startsWith('en') ? `<div class="notice warn">The free voices speak English only. For ${esc(ai.langName(p.language))}, switch to AI mode for multilingual voices, or upload your own recording for each scene (⬆).</div>` : ''}</div>
    <div class="hint" id="modelStatus" hidden style="margin:8px 0"></div>
    <div class="row" style="margin-top:6px">
      <button class="btn" id="btnSample">▶ Hear sample</button>
      <button class="btn primary" id="btnVoAll" ${!p.scenes.length ? 'disabled' : ''}>🎙 ${missing ? `Generate voiceover (${missing} scene${missing > 1 ? 's' : ''})` : 'Regenerate all'}</button>
    </div>
    <p class="hint" style="margin:10px 0 0">Changing the language here changes the voice only. To translate the script, change the language on the Topic step and rewrite it.</p>
  </div>
  <div class="card">
    <h3>Your own voiceover</h3>
    <p class="hint" style="margin:0 0 10px">Recorded the narration yourself? Upload one audio file for the whole video. It is split across the scenes automatically (at the pauses), and the edit is timed to it. You can also upload a recording for a single scene with ⬆ below.</p>
    <button class="btn" id="btnVoUpload" ${!p.scenes.length ? 'disabled' : ''}>⬆ Upload your voiceover</button>
  </div>
  <div class="card"><h3>Scenes</h3>${p.scenes.length ? p.scenes.map((s, i) => `<div class="vo-row" data-id="${s.id}">${voiceRowHTML(s, i)}</div>`).join('') : '<div class="empty-state">Write a script first.</div>'}</div>
  <div class="card">
    <h3>Background music (optional)</h3>
    <p class="hint" style="margin:0 0 10px">Upload a track you have the rights to. It loops under the narration and fades out at the end.</p>
    <div class="row" style="align-items:center">
      <button class="btn" id="btnMusic">${p.music ? '↻ Replace music' : '⬆ Upload music'}</button>
      ${p.music ? `<span class="hint">${esc(p.music.name || 'Track')}</span><button class="btn sm ghost danger" id="btnMusicDel">Remove</button>` : ''}
    </div>
    ${p.music ? `<div class="field" style="margin-top:12px"><label>Music volume</label><input type="range" id="musicVol" min="0" max="0.8" step="0.02" value="${p.music.volume ?? 0.25}"></div>` : ''}
  </div>
  ${nextRow('Visuals', 'Edit & Export')}`;
  $$('#prov button', pane).forEach((b) => b.onclick = () => { v.provider = b.dataset.v; v.voice = ''; save(); renderVoice(pane); });
  $('#vlang', pane).onchange = (e) => { p.language = e.target.value; v.language = p.language; v.voice = ''; save(); renderVoice(pane); };
  $('#voiceSel', pane).onchange = (e) => { v.voice = e.target.value; save(); fillVoices(pane); };
  const eng = $('#engineSel', pane); if (eng) eng.onchange = (e) => { v.engine = e.target.value; save(); };
  $('#btnSample', pane).onclick = async (e) => {
    if (v.provider !== 'kokoro' && !(await ensureAuth())) return;
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Loading';
    try {
      const text = (p.scenes[0] && p.scenes[0].narration) || p.topic || `Hi! This is how your ${BRAND.name} videos will sound.`;
      const blob = await speakText(text.split(/(?<=[.!?।])\s/)[0].slice(0, 220));
      if (rowAudio) rowAudio.pause(); rowAudio = new Audio(URL.createObjectURL(blob)); rowAudio.play();
    } catch (err) { handleAIError(err); }
    b.disabled = false; b.textContent = '▶ Hear sample';
  };
  $('#btnVoAll', pane).onclick = async () => {
    if (v.provider !== 'kokoro' && !(await ensureAuth())) return;
    let list = p.scenes.filter((s) => (!s.audioKey || s.audioText !== s.narration) && !busy.has(s.id));
    if (!list.length) { if (!(await confirmBox('Regenerate every voice clip?', 'This replaces the whole voiceover with the selected voice.', 'Regenerate'))) return; list = p.scenes.filter((s) => !busy.has(s.id)); }
    toast(`Recording ${list.length} voice clip${list.length > 1 ? 's' : ''}…${v.provider === 'kokoro' ? ' The free voice runs on your device, about a few seconds per scene.' : ''}`);
    if (v.provider !== 'kokoro' && creditsOut) { renderCreditsBanner(); toast('Your Puter credits are used up. Switch to Free mode for the free voice.', 'err'); return; }
    const r = await aiPool(list, v.provider === 'kokoro' ? 1 : 3, genVoice);
    if (r.creditsHit) toast('Credits ran out, so the voiceover stopped. Use Free mode for the free on-device voice.', 'err');
    else if (r.errors.length) { handleAIError(r.errors[0]); if (r.errors.length > 1) toast(`${r.errors.length} voice clips failed.`, 'err'); }
    else toast('Voiceover ready. The edit is timed to it.', 'ok');
    renderVoice(pane);
  };
  $$('.vo-row', pane).forEach((row) => bindVoiceRow(row, p.scenes.find((x) => x.id === row.dataset.id)));
  $('#btnVoUpload', pane).onclick = async () => {
    const f = await pickFile('audio/*'); if (!f) return;
    const b = $('#btnVoUpload', pane); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Splitting across scenes…';
    try {
      const n = await splitVoiceover(f);
      toast(`Voiceover split across ${n} scene${n > 1 ? 's' : ''}. The edit is timed to it.`, 'ok');
    } catch (err) { console.error(err); toast('Could not read that audio file. Try an MP3, M4A or WAV.', 'err'); }
    renderVoice(pane); renderStepper(); invalidatePreview();
  };
  $('#btnMusic', pane).onclick = async () => {
    const f = await pickFile('audio/*'); if (!f) return;
    const key = `${p.id}/music-${uid()}`; await store.putBlob(key, f);
    if (p.music && p.music.key) { store.deleteBlob(p.music.key); bank.forget(p.music.key); }
    p.music = { key, name: f.name, volume: p.music ? p.music.volume : 0.25 }; touched(); renderVoice(pane);
  };
  const del = $('#btnMusicDel', pane); if (del) del.onclick = () => { store.deleteBlob(p.music.key); bank.forget(p.music.key); p.music = null; touched(); renderVoice(pane); };
  const vol = $('#musicVol', pane); if (vol) vol.oninput = () => { p.music.volume = +vol.value; touched(); };
  fillVoices(pane);
  bindModeLinks(pane);
  bindNext(pane);
}

// ---------- step 5: edit & export ----------
function renderExport(pane) {
  const p = project; const tl = buildTimeline(p);
  const noVoice = p.scenes.filter((s) => !s.audioKey).length;
  const noVis = p.scenes.filter((s) => !s.imageKey && !s.videoKey).length;
  pane.innerHTML = `
  <div class="panel-title"><div><h2>Edit &amp; Export</h2><p>The edit is automatic: every shot is timed to its voiceover, stills get slow camera motion, captions follow the narration.</p></div>
    <button class="btn sm mobile-only" id="btnPrevInline">▶ Preview</button></div>
  ${noVoice || noVis ? `<div class="notice warn" style="margin-bottom:14px">${noVis ? `<b>${noVis}</b> scene${noVis > 1 ? 's have' : ' has'} no visual (a placeholder is used). ` : ''}${noVoice ? `<b>${noVoice}</b> scene${noVoice > 1 ? 's have' : ' has'} no voiceover (timed from the text, silent).` : ''}</div>` : ''}
  <div class="card">
    <h3>Style</h3>
    <label class="toggle"><input type="checkbox" id="capOn" ${p.captions.enabled !== false ? 'checked' : ''}> Burn in captions</label>
    <div class="seg" id="capStyle" style="margin:10px 0 4px">${[['bold', 'Bold pop'], ['outline', 'Outline'], ['clean', 'Clean box']].map(([v, l]) => `<button data-v="${v}" class="${p.captions.style === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="lbl" style="margin-top:14px">Transitions</div>
    <div class="seg" id="trans" style="margin-top:6px">${[['crossfade', 'Crossfade'], ['slide', 'Slide'], ['fade-black', 'Dip to black'], ['cut', 'Hard cut']].map(([v, l]) => `<button data-v="${v}" class="${p.transition === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div style="margin-top:14px;display:flex;flex-direction:column;gap:10px">
      <label class="toggle"><input type="checkbox" id="kb" ${p.kenBurns !== false ? 'checked' : ''}> Camera motion on still images (Ken Burns)</label>
      <label class="toggle"><input type="checkbox" id="fio" ${p.fadeInOut !== false ? 'checked' : ''}> Fade in and out</label>
    </div>
  </div>
  <div class="card">
    <h3>Shots · ${fmtTime(tl.duration)} total</h3>
    ${tl.items.map((it, i) => `<div class="vo-row" data-id="${it.scene.id}" style="grid-template-columns:30px minmax(0,1fr) auto">
      <div class="idx" style="width:26px;height:26px;border-radius:8px;background:var(--panel2);display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--muted)">${i + 1}</div>
      <div><input type="text" data-f="caption" placeholder="${esc((it.scene.narration || 'Caption').slice(0, 80))}" title="Caption text (leave empty to use the narration)" value="${esc(it.scene.caption)}" style="padding:7px 10px;font-size:13px"><span class="dur">${fmtTime(it.start)} · ${it.dur.toFixed(1)}s${it.scene.videoKey && it.scene.useVideo !== false ? ' · AI clip' : ''}</span></div>
      <div class="row" style="flex-wrap:nowrap;gap:2px"><button class="btn icon ghost" data-a="up" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn icon ghost" data-a="down" ${i === tl.items.length - 1 ? 'disabled' : ''}>↓</button><button class="btn icon ghost" data-a="seek" title="Preview from here">▶</button></div>
    </div>`).join('')}
  </div>
  <div class="card" id="exportCard">
    <h3>Export</h3>
    <div class="row" style="align-items:center">
      <div class="seg" id="fmt2"><button data-v="16:9" class="${p.format === '16:9' ? 'on' : ''}">16:9</button><button data-v="9:16" class="${p.format === '9:16' ? 'on' : ''}">9:16 Shorts</button></div>
      <div class="seg" id="res"><button data-v="1080" class="${p.exportHeight !== 720 ? 'on' : ''}">1080p</button><button data-v="720" class="${p.exportHeight === 720 ? 'on' : ''}">720p</button></div>
    </div>
    <p class="hint" style="margin:10px 0">${(() => { const { w, h } = canvasSize(p.format, p.exportHeight || 1080); return `${w}×${h} MP4 · 30 fps · rendered on your device, nothing is uploaded.`; })()}${p.format === '9:16' && tl.duration > 180 ? ' Note: YouTube Shorts must be 3 minutes or shorter.' : ''}</p>
    <button class="btn primary lg" id="btnExport" ${!p.scenes.length ? 'disabled' : ''}>⬇ Export MP4</button>
    <div id="exportStatus" style="margin-top:14px"></div>
  </div>
  ${nextRow('Voice', '')}`;
  $('#capOn', pane).onchange = (e) => { p.captions.enabled = e.target.checked; touched(); };
  $$('#capStyle button', pane).forEach((b) => b.onclick = () => { p.captions.style = b.dataset.v; p.captions.enabled = true; $('#capOn', pane).checked = true; touched(); $$('#capStyle button', pane).forEach((x) => x.classList.toggle('on', x === b)); });
  $$('#trans button', pane).forEach((b) => b.onclick = () => { p.transition = b.dataset.v; touched(); $$('#trans button', pane).forEach((x) => x.classList.toggle('on', x === b)); });
  $('#kb', pane).onchange = (e) => { p.kenBurns = e.target.checked; touched(); };
  $('#fio', pane).onchange = (e) => { p.fadeInOut = e.target.checked; touched(); };
  $$('#fmt2 button', pane).forEach((b) => b.onclick = async () => {
    if (b.dataset.v === p.format) return;
    const hasImgs = p.scenes.some((s) => s.imageKey);
    p.format = b.dataset.v; touched(); setupPlayer(); renderExport(pane);
    if (hasImgs) toast('Images are re-framed automatically. For best results, regenerate them in this shape on the Visuals step.');
  });
  $$('#res button', pane).forEach((b) => b.onclick = () => { p.exportHeight = +b.dataset.v; save(); renderExport(pane); });
  const pi = $('#btnPrevInline', pane); if (pi) pi.onclick = () => { document.body.classList.add('show-preview'); refreshPreview(); };
  $$('.vo-row', pane).forEach((row) => {
    const s = p.scenes.find((x) => x.id === row.dataset.id);
    $('[data-f="caption"]', row).oninput = (e) => { s.caption = e.target.value; touched(); };
    $$('[data-a]', row).forEach((b) => b.onclick = () => {
      const i = p.scenes.indexOf(s); const a = b.dataset.a;
      if (a === 'seek') { const t = buildTimeline(p).items[i].start; seekTo(t); if (window.innerWidth <= 900) { document.body.classList.add('show-preview'); } play(); return; }
      const j = a === 'up' ? i - 1 : i + 1; [p.scenes[i], p.scenes[j]] = [p.scenes[j], p.scenes[i]]; touched(); renderExport(pane);
    });
  });
  $('#btnExport', pane).onclick = () => doExport(pane);
  bindNext(pane);
}

// Sponsored slot: only on the finished export screen, created once per page.
let adBox = null;
function showSponsored(host) {
  try {
    if (!host) return;
    if (!adBox) {
      adBox = document.createElement('aside');
      adBox.className = 'ad-box';
      adBox.setAttribute('aria-label', 'Sponsored');
      adBox.innerHTML = '<div class="ad-label">Sponsored</div><div id="container-2d36111a05a69d2062d1d06b96b76005"></div>';
      host.appendChild(adBox);
      const s = document.createElement('script');
      s.async = true; s.setAttribute('data-cfasync', 'false');
      s.src = 'https://bauval.org/21/2d36111a05a69d2062d1d06b96b76005';
      adBox.insertBefore(s, adBox.lastChild);
    } else host.appendChild(adBox);
  } catch (e) { /* ad is optional */ }
}

let exportAbort = null;
async function doExport(pane) {
  const p = project; const st = $('#exportStatus', pane); const btn = $('#btnExport', pane);
  stopPlayback();
  btn.disabled = true; exportAbort = new AbortController();
  st.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px"><b id="exPhase">Preparing…</b><button class="btn sm" id="exCancel">Cancel</button></div><div class="progress"><div id="exBar"></div></div><p class="hint" id="exEta" style="margin:6px 0 0">Keep this tab open while it renders.</p>`;
  $('#exCancel', st).onclick = () => exportAbort.abort();
  try {
    await bank.load(p);
    const tl = buildTimeline(p);
    let wake = null; try { wake = await navigator.wakeLock?.request('screen'); } catch (e) { /* optional */ }
    const t0 = performance.now();
    const res = await exportVideo({ project: p, timeline: tl, bank, height: p.exportHeight || 1080, signal: exportAbort.signal,
      onProgress: ({ phase, p: pr, eta }) => { const ph = $('#exPhase'); if (!ph) return; ph.textContent = `${phase} · ${Math.round(pr * 100)}%`; $('#exBar').style.width = `${pr * 100}%`; if (eta != null) $('#exEta').textContent = `About ${fmtTime(eta)} left. Keep this tab open.`; } });
    try { wake && wake.release(); } catch (e) { /* ignore */ }
    const url = URL.createObjectURL(res.blob);
    const fname = `${(p.name || 'video').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'video'}-${p.format === '9:16' ? 'shorts' : 'youtube'}.${res.ext}`;
    const mb = (res.blob.size / 1048576).toFixed(1);
    st.innerHTML = `<div class="export-result"><div class="notice" style="margin-bottom:12px"><b>Done!</b> ${res.width}×${res.height} · ${fmtTime(res.duration)} · ${mb} MB · rendered in ${fmtTime((performance.now() - t0) / 1000)}</div>
      <video src="${url}" controls playsinline></video>
      <div class="row" style="margin-top:12px"><a class="btn primary" href="${url}" download="${esc(fname)}" id="dlLink">⬇ Download ${res.ext.toUpperCase()}</a><button class="btn" id="btnShare" hidden>Share</button></div></div>`;
    const file = new File([res.blob], fname, { type: res.blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { const sb = $('#btnShare', st); sb.hidden = false; sb.onclick = () => navigator.share({ files: [file], title: p.name }).catch(() => {}); }
    showSponsored(st.querySelector('.export-result'));
    mountBanner(st.querySelector('.export-result'));
    window.__lastExport = { size: res.blob.size, type: res.blob.type, videoCodec: res.videoCodec, audioCodec: res.audioCodec, duration: res.duration, width: res.width, height: res.height, url };
    toast('Your video is ready', 'ok');
  } catch (e) {
    if (e && e.name === 'AbortError') st.innerHTML = '<p class="hint">Export cancelled.</p>';
    else { console.error(e); st.innerHTML = `<div class="notice warn">Export failed: ${esc(e && e.message || e)}. Try 720p, or a recent version of Chrome, Edge or Safari.</div>`; }
  } finally { btn.disabled = false; exportAbort = null; }
}

// ---------- preview player ----------
const canvas = $('#previewCanvas'); const pctx = canvas.getContext('2d');
let timeline = { items: [], duration: 0 };
let playhead = 0; let playing = false; let audioCtx = null; let audioSrc = null; let playStart = 0; let mixCache = null; let mixSig = '';
let previewDirty = true;

function setupPlayer() {
  const { w, h } = canvasSize(project.format, project.format === '9:16' ? 480 : 540);
  canvas.width = w; canvas.height = h;
  $('#player').classList.toggle('portrait', project.format === '9:16');
  invalidatePreview();
}
function invalidatePreview() { previewDirty = true; if (playing) stopPlayback(); clearTimeout(invalidatePreview.t); invalidatePreview.t = setTimeout(refreshPreview, 250); }
async function refreshPreview() {
  timeline = buildTimeline(project);
  $('#playerEmpty').style.display = project.scenes.length ? 'none' : 'grid';
  playhead = Math.min(playhead, timeline.duration);
  await bank.load(project);
  previewDirty = false;
  drawAt(playhead); renderTimelineStrip();
}
function drawAt(t) {
  drawFrame(pctx, canvas.width, canvas.height, project, timeline, bank, t, { noFade: !playing });
  $('#timeLbl').textContent = `${fmtTime(t)} / ${fmtTime(timeline.duration)}`;
  $('#scrub').value = timeline.duration ? Math.round(t / timeline.duration * 1000) : 0;
  const cur = sceneAt(timeline, t);
  $$('#timeline .tl-clip').forEach((c, i) => c.classList.toggle('cur', i === cur));
}
async function renderTimelineStrip() {
  const strip = $('#timeline');
  const pxs = Math.max(10, Math.min(28, 520 / Math.max(1, timeline.duration)));
  strip.innerHTML = timeline.items.map((it, i) => `<div class="tl-clip" data-i="${i}" style="width:${Math.max(44, it.dur * pxs)}px" title="Scene ${i + 1} · ${it.dur.toFixed(1)}s">${it.scene.imageKey ? `<img data-key="${it.scene.imageKey}" alt="">` : `<canvas data-card="${it.scene.id}" width="160" height="90" style="width:100%;height:100%;opacity:.8"></canvas>`}<span>${i + 1}</span>${it.scene.audioKey ? '<div class="wave"></div>' : ''}</div>`).join('');
  $$('.tl-clip', strip).forEach((c) => c.onclick = () => seekTo(timeline.items[+c.dataset.i].start + 0.01));
  hydrateThumbs(strip);
  drawAt(playhead);
}
function seekTo(t) {
  const was = playing; if (playing) stopPlayback();
  playhead = Math.max(0, Math.min(timeline.duration, t));
  for (const { video, time } of videosAt(timeline, playhead, bank)) video.currentTime = time;
  setTimeout(() => drawAt(playhead), 60);
  drawAt(playhead);
  if (was) play();
}
async function play() {
  if (!project.scenes.length) return;
  if (previewDirty) await refreshPreview();
  if (playhead >= timeline.duration - 0.05) playhead = 0;
  const sig = JSON.stringify([project.scenes.map((s) => [s.audioKey, s.durOverride]), project.music]);
  if (!mixCache || mixSig !== sig) { $('#timeLbl').textContent = 'Preparing audio…'; mixCache = await mixAudio(project, timeline, bank); mixSig = sig; }
  audioCtx = audioCtx || new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  audioSrc = audioCtx.createBufferSource(); audioSrc.buffer = mixCache; audioSrc.connect(audioCtx.destination);
  playStart = audioCtx.currentTime - playhead; audioSrc.start(0, playhead);
  playing = true; setPlayIcon();
  const tick = () => {
    if (!playing) return;
    playhead = audioCtx.currentTime - playStart;
    if (playhead >= timeline.duration) { stopPlayback(); playhead = timeline.duration; drawAt(playhead); return; }
    const active = videosAt(timeline, playhead, bank);
    for (const v of bank.videos.values()) if (v && !active.find((a) => a.video === v) && !v.paused) v.pause();
    for (const { video, time } of active) { if (video.paused) video.play().catch(() => {}); if (Math.abs(video.currentTime - time) > 0.3) video.currentTime = time; }
    drawAt(playhead);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function stopPlayback() {
  playing = false; setPlayIcon();
  try { audioSrc && audioSrc.stop(); } catch (e) { /* already stopped */ }
  audioSrc = null;
  for (const v of bank.videos.values()) if (v) v.pause();
}
function setPlayIcon() {
  $('#btnPlay').innerHTML = playing ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M7 4.5v15l12-7.5z"/></svg>';
}
$('#btnPlay').onclick = () => (playing ? stopPlayback() : play());
$('#scrub').oninput = (e) => seekTo(e.target.value / 1000 * timeline.duration);
document.addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#btnPlay').click(); } });

// ---------- projects drawer ----------
async function renderProjectList() {
  const list = await store.listProjects();
  const el = $('#projList');
  el.innerHTML = list.map((p) => `<div class="proj-item ${p.id === project.id ? 'cur' : ''}" data-id="${p.id}"><div class="pt">${p.scenes && p.scenes[0] && p.scenes[0].imageKey ? `<img data-key="${p.scenes[0].imageKey}" alt="">` : ''}</div>
    <div class="grow"><b>${esc(p.name || 'Untitled')}</b><small>${(p.scenes || []).length} scenes · ${p.format} · ${new Date(p.updatedAt).toLocaleDateString()}</small></div>
    <button class="btn icon ghost danger" data-del title="Delete">✕</button></div>`).join('') || '<div class="empty-state">No projects yet.</div>';
  hydrateThumbs(el);
  $$('.proj-item', el).forEach((it) => {
    it.onclick = async (e) => {
      if (e.target.closest('[data-del]')) {
        if (!(await confirmBox('Delete project?', 'This removes the project and all its media from this browser.', 'Delete'))) return;
        await store.deleteProject(it.dataset.id);
        if (it.dataset.id === project.id) { const rest = await store.listProjects(); await openProject(rest[0] ? rest[0].id : null); }
        renderProjectList(); return;
      }
      await openProject(it.dataset.id); closeDrawer();
    };
  });
}
function openDrawer() { $('#drawer').classList.add('open'); $('#drawerBg').classList.add('open'); renderProjectList(); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawerBg').classList.remove('open'); }
$('#btnProjects').onclick = openDrawer; $('#drawerBg').onclick = closeDrawer;
$('#btnNewProject').onclick = async () => { await openProject(null); closeDrawer(); };
$('#projName').oninput = (e) => { project.name = e.target.value; save(); };

async function openProject(id) {
  stopPlayback(); bank.dispose(); bank = new AssetBank(); mixCache = null; playhead = 0;
  for (const u of thumbs.values()) URL.revokeObjectURL(u); thumbs.clear();
  let p = id ? await store.getProject(id) : null;
  if (!p) { p = newProject(); await store.saveProject(p); }
  project = p; step = p.step || 0;
  $('#projName').value = p.name;
  await store.kvSet('lastProject', p.id);
  if (isFree() && project.voice.provider !== 'kokoro' && !project.scenes.some((s) => s.audioKey)) project.voice = { provider: 'kokoro', voice: 'am_michael', engine: '', language: project.language };
  setupPlayer(); renderMode(); renderStepper(); renderPane(); refreshPreview();
}

// ---------- boot ----------
(async function boot() {
  await settingsReady;
  store.requestPersistence();
  const params = new URLSearchParams(location.search);
  const last = params.get('new') ? null : params.get('project') || await store.kvGet('lastProject');
  await Promise.race([refreshAccount(), sleep(4000)]);
  await openProject(last);
  if (params.get('new') || params.get('project')) history.replaceState(null, '', location.pathname);
  if (!(await store.kvGet('welcomed'))) {
    store.kvSet('welcomed', 1);
    modal(`<h3>Welcome to ${esc(BRAND.name)} 👋</h3><p>Pick a topic, and the studio writes the script, makes the images, records the voiceover and edits it all into a finished MP4.</p>
      <p><b>Free mode</b> works straight away with no sign-in: a script from Wikipedia facts, animated title cards and a free on-device voice.<br><b>AI mode</b> adds AI-written scripts, AI images, video clips and voices in many languages, using your own free Puter account.${SIGNIN_LOG_URL ? ' ' + esc(SIGNIN_NOTICE) : ''}</p>
      <div class="acts"><button class="btn" data-close>Start in Free mode</button><button class="btn primary" id="mGo">Sign in for AI mode</button></div>`,
      (m, close) => { $('#mGo', m).onclick = async () => { close(); if (await ensureAuth()) { setMode('ai'); toast('Signed in. Type a topic to begin!', 'ok'); } }; });
  }
})();
