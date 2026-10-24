// Timeline engine: turns a project + its media into frames and a mixed soundtrack.
// The same drawFrame() powers the live preview and the MP4 export, so what you see is what you get.
import { getBlob } from './store.js';

export const FPS = 30;
export const SAMPLE_RATE = 48000;
const TRANSITION = 0.45;   // seconds of crossfade between scenes
const LEAD = 0.15;         // silence before each scene's voice
const TAIL = 0.35;         // breathing room after each scene's voice

// "p" is the short side, as in 1080p: 16:9 -> 1920x1080, 9:16 -> 1080x1920.
export function canvasSize(format, p = 1080) {
  const long = Math.round(p * 16 / 9 / 2) * 2;
  return format === '9:16' ? { w: p, h: long } : { w: long, h: p };
}

export function wordsPerSecond(text) { return /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(text) ? 6 : 2.5; }

// Auto-edit: each scene lasts as long as its voiceover (plus padding); unvoiced scenes are estimated from the text.
export function buildTimeline(project) {
  let t = 0;
  const items = project.scenes.map((s, i) => {
    const text = (s.narration || '').trim();
    const est = Math.max(2.5, text.split(/\s+/).filter(Boolean).length / wordsPerSecond(text));
    const speech = s.audioDur ? s.audioDur : 0;
    const dur = s.durOverride ? s.durOverride : speech ? LEAD + speech + TAIL : est;
    const item = { index: i, scene: s, start: t, dur, speechStart: t + LEAD, speechDur: speech || Math.max(1, dur - LEAD - TAIL) };
    t += dur;
    return item;
  });
  return { items, duration: t };
}

function seeded(i) { const x = Math.sin(i * 9301 + 49297) * 233280; return x - Math.floor(x); }

export class AssetBank {
  constructor() { this.images = new Map(); this.videos = new Map(); this.audio = new Map(); this.urls = []; }
  async load(project, onProgress) {
    const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 1, SAMPLE_RATE);
    let done = 0;
    const total = project.scenes.length + (project.music && project.music.key ? 1 : 0);
    for (const s of project.scenes) {
      if (s.imageKey && !this.images.has(s.imageKey)) {
        const b = await getBlob(s.imageKey);
        if (b) { try { this.images.set(s.imageKey, await createImageBitmap(b)); } catch (e) { /* unreadable image */ } }
      }
      if (s.videoKey && s.useVideo !== false && !this.videos.has(s.videoKey)) {
        const b = await getBlob(s.videoKey);
        if (b) this.videos.set(s.videoKey, await this.makeVideo(b));
      }
      if (s.audioKey && !this.audio.has(s.audioKey)) {
        const b = await getBlob(s.audioKey);
        if (b) { try { this.audio.set(s.audioKey, await ac.decodeAudioData(await b.arrayBuffer())); } catch (e) { /* undecodable */ } }
      }
      onProgress && onProgress(++done / total);
    }
    if (project.music && project.music.key && !this.audio.has(project.music.key)) {
      const b = await getBlob(project.music.key);
      if (b) { try { this.audio.set(project.music.key, await ac.decodeAudioData(await b.arrayBuffer())); } catch (e) { /* ignore */ } }
      onProgress && onProgress(1);
    }
    return this;
  }
  makeVideo(blob) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
      const url = URL.createObjectURL(blob); this.urls.push(url);
      v.src = url;
      v.onloadeddata = () => resolve(v);
      v.onerror = () => resolve(null);
    });
  }
  forget(key) { this.images.delete(key); this.videos.delete(key); this.audio.delete(key); }
  dispose() { this.urls.forEach((u) => URL.revokeObjectURL(u)); this.urls = []; }
}

// ---------- captions ----------
export function captionChunks(text, maxWords) {
  const cjk = /[\u3040-\u30ff\u4e00-\u9fff]/.test(text);
  if (cjk) {
    const chars = [...text.replace(/\s+/g, '')];
    const out = []; const n = maxWords * 3;
    for (let i = 0; i < chars.length; i += n) out.push(chars.slice(i, i + n).join(''));
    return out.map((c) => ({ text: c, words: [c] }));
  }
  // Split per sentence, then into evenly sized chunks so no caption is left with one orphan word.
  const sentences = text.split(/(?<=[.!?।])\s+/).map((s) => s.split(/\s+/).filter(Boolean)).filter((s) => s.length);
  const out = [];
  for (const ws of sentences) {
    const k = Math.ceil(ws.length / maxWords);
    const size = Math.ceil(ws.length / k);
    for (let i = 0; i < ws.length; i += size) out.push(ws.slice(i, i + size));
  }
  return out.map((ws) => ({ text: ws.join(' '), words: ws }));
}

function weight(s) { return Math.max(1, s.replace(/[^\p{L}\p{N}]/gu, '').length) + 2; }

function activeCaption(item, t, maxWords) {
  const text = (item.scene.caption != null && item.scene.caption !== '' ? item.scene.caption : item.scene.narration || '').trim();
  if (!text) return null;
  const chunks = captionChunks(text, maxWords);
  const total = chunks.reduce((a, c) => a + weight(c.text), 0);
  const rel = (t - item.speechStart) / item.speechDur;
  if (rel < -0.02 || rel > 1.06) return null;
  let acc = 0;
  for (const c of chunks) {
    const w = weight(c.text) / total;
    if (rel <= acc + w || c === chunks[chunks.length - 1]) {
      const local = Math.min(1, Math.max(0, (rel - acc) / w));
      const ww = c.words.map(weight); const wt = ww.reduce((a, b) => a + b, 0);
      let a2 = 0, wi = 0;
      for (let k = 0; k < ww.length; k++) { if (local <= a2 + ww[k] / wt) { wi = k; break; } a2 += ww[k] / wt; wi = k; }
      return { chunk: c, wordIndex: wi };
    }
    acc += w;
  }
  return null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function wrapLines(ctx, words, maxW) {
  const lines = []; let line = [];
  for (let i = 0; i < words.length; i++) {
    const test = [...line, words[i]].map((x) => x.w).join(' ');
    if (line.length && ctx.measureText(test).width > maxW) { lines.push(line); line = []; }
    line.push(words[i]);
  }
  if (line.length) lines.push(line);
  return lines;
}

function drawCaption(ctx, W, H, cap, style, portrait) {
  const base = portrait ? W * 0.078 : H * 0.068;
  const upper = style === 'bold';
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = `${upper ? 800 : 700} ${Math.round(base)}px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
  const words = cap.chunk.words.map((w, i) => ({ w: upper ? w.toUpperCase() : w, i }));
  const lines = wrapLines(ctx, words, W * (portrait ? 0.84 : 0.78));
  const lh = base * 1.22;
  const yc = portrait ? H * 0.70 : H * 0.83;
  const y0 = yc - (lines.length - 1) * lh / 2;
  if (style === 'clean') {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l.map((x) => x.w).join(' ')).width));
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, W / 2 - widest / 2 - base * 0.5, y0 - lh / 2 - base * 0.18, widest + base, lh * lines.length + base * 0.36, base * 0.3);
    ctx.fill();
  }
  lines.forEach((line, li) => {
    const y = y0 + li * lh;
    const full = line.map((x) => x.w).join(' ');
    let x = W / 2 - ctx.measureText(full).width / 2;
    for (const wd of line) {
      const ww = ctx.measureText(wd.w).width;
      const on = style === 'bold' && wd.i === cap.wordIndex;
      ctx.lineJoin = 'round';
      if (style !== 'clean') { ctx.lineWidth = base * 0.16; ctx.strokeStyle = 'rgba(0,0,0,0.92)'; ctx.strokeText(wd.w, x, y); }
      ctx.fillStyle = on ? '#FFD84D' : '#FFFFFF';
      ctx.fillText(wd.w, x, y);
      x += ww + ctx.measureText(' ').width;
    }
  });
  ctx.restore();
}

function drawCover(ctx, src, sw, sh, W, H, zoom, px, py) {
  const s = Math.max(W / sw, H / sh) * zoom;
  const dw = sw * s, dh = sh * s;
  const ox = (W - dw) / 2 + px * (dw - W) / 2;
  const oy = (H - dh) / 2 + py * (dh - H) / 2;
  ctx.drawImage(src, ox, oy, dw, dh);
}

// Animated title card, used for any scene without an image (the look of Free mode).
const PALETTES = [['#2a1b6e', '#7c5cff', '#ff5c8a'], ['#06283d', '#1fb6ff', '#7cf2c8'], ['#3a0d2e', '#ff5c8a', '#ffb648'], ['#0f2a1d', '#2fd39a', '#d8ff5c'], ['#1d1a3a', '#c45cff', '#5ce1ff'], ['#2b1608', '#ff8a3d', '#ffd84d']];
export function drawCard(ctx, W, H, item, lt, project) {
  const pal = PALETTES[item.index % PALETTES.length];
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, pal[0]); g.addColorStop(1, '#07080d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const u = Math.min(W, H);
  // drifting light blobs
  for (let k = 0; k < 3; k++) {
    const x = W * (0.2 + 0.6 * seeded(item.index * 7 + k)) + Math.sin(lt * 0.4 + k * 2) * u * 0.06;
    const y = H * (0.25 + 0.5 * seeded(item.index * 11 + k)) + Math.cos(lt * 0.33 + k) * u * 0.05;
    const r = u * (0.35 + 0.25 * seeded(item.index + k * 5));
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, (k % 2 ? pal[2] : pal[1]) + '55'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  }
  // fine grid texture
  ctx.save(); ctx.globalAlpha = 0.06; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  const step = u / 14; const off = (lt * 8) % step;
  for (let x = -step + off; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = -step + off; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();
  const portrait = H > W;
  const label = String(project.title || project.topic || '').toUpperCase().slice(0, 48);
  const head = String(item.scene.visual || '').trim() || `Scene ${item.index + 1}`;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let fs = Math.round(portrait ? W * 0.095 : H * 0.105);
  const maxW = W * (portrait ? 0.84 : 0.74);
  const words = head.split(/\s+/).map((w) => ({ w }));
  const setFont = () => { ctx.font = `800 ${fs}px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`; };
  setFont();
  // shrink the headline until the longest word fits and it takes at most 4 lines
  let lines = wrapLines(ctx, words, maxW);
  while (fs > 18 && (lines.length > 4 || Math.max(...words.map((x) => ctx.measureText(x.w).width)) > maxW)) { fs = Math.round(fs * 0.9); setFont(); lines = wrapLines(ctx, words, maxW); }
  const lh = fs * 1.12; const yc = portrait ? H * 0.42 : H * 0.42;
  const y0 = yc - (lines.length - 1) * lh / 2;
  let n = 0;
  lines.forEach((line, li) => {
    const txt = line.map((x) => x.w).join(' ');
    let x = W / 2 - ctx.measureText(txt).width / 2;
    for (const wd of line) {
      const a = Math.min(1, Math.max(0, (lt - 0.15 - n * 0.09) / 0.35));
      const ww = ctx.measureText(wd.w).width;
      ctx.globalAlpha = a; ctx.fillStyle = '#fff';
      ctx.fillText(wd.w, x + ww / 2, y0 + li * lh + (1 - a) * fs * 0.35);
      x += ww + ctx.measureText(' ').width; n++;
    }
  });
  // accent bar + label
  const barA = Math.min(1, Math.max(0, lt / 0.6));
  ctx.globalAlpha = 1;
  const bw = u * 0.16 * barA; const by = y0 - lh * 0.95;
  const bg = ctx.createLinearGradient(W / 2 - bw / 2, 0, W / 2 + bw / 2, 0); bg.addColorStop(0, pal[1]); bg.addColorStop(1, pal[2]);
  ctx.fillStyle = bg; ctx.fillRect(W / 2 - bw / 2, by, bw, Math.max(4, u * 0.008));
  if (label) {
    ctx.globalAlpha = 0.75 * barA; ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.round(u * 0.028)}px Inter, system-ui, sans-serif`;
    ctx.fillText(label, W / 2, by - u * 0.045);
  }
  ctx.restore();
}

// Draw one scene's visual at local time lt (seconds into the scene).
function drawVisual(ctx, W, H, item, lt, bank, project, still) {
  const s = item.scene;
  const v = s.videoKey && s.useVideo !== false ? bank.videos.get(s.videoKey) : null;
  if (v && v.videoWidth) {
    drawCover(ctx, v, v.videoWidth, v.videoHeight, W, H, 1.0, 0, 0);
    return;
  }
  const img = s.imageKey ? bank.images.get(s.imageKey) : null;
  if (!img) { drawCard(ctx, W, H, item, still ? Math.max(lt, 1.5) : lt, project); return; }
  let zoom = 1, px = 0, py = 0;
  if (project.kenBurns !== false) {
    const p = Math.min(1, Math.max(0, lt / (item.dur + TRANSITION)));
    const e = p * p * (3 - 2 * p) * 0.5 + p * 0.5;
    const mode = Math.floor(seeded(item.index) * 4);
    const amt = 0.14;
    if (mode === 0) zoom = 1 + amt * e;                         // push in
    else if (mode === 1) zoom = 1 + amt * (1 - e);              // pull out
    else if (mode === 2) { zoom = 1 + amt * 0.8; px = -0.9 + 1.8 * e; } // pan right
    else { zoom = 1 + amt * 0.8; px = 0.9 - 1.8 * e; py = 0.3 - 0.6 * e; } // pan left/up
  }
  drawCover(ctx, img, img.width, img.height, W, H, zoom, px, py);
}

export function sceneAt(timeline, t) {
  const items = timeline.items;
  for (let i = 0; i < items.length; i++) if (t < items[i].start + items[i].dur) return i;
  return items.length - 1;
}

// Video elements that should be showing at time t, with the clip-local time for each.
export function videosAt(timeline, t, bank) {
  const out = [];
  const i = sceneAt(timeline, t);
  for (const k of [i, i + 1]) {
    const it = timeline.items[k];
    if (!it) continue;
    const s = it.scene;
    const v = s.videoKey && s.useVideo !== false ? bank.videos.get(s.videoKey) : null;
    if (!v || !v.duration) continue;
    const lt = t - it.start;
    if (lt < -TRANSITION) continue;
    out.push({ video: v, time: Math.max(0, lt) % Math.max(0.1, v.duration - 0.05) });
  }
  return out;
}

export function drawFrame(ctx, W, H, project, timeline, bank, t, opts = {}) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (!timeline.items.length) return;
  const i = sceneAt(timeline, t);
  const it = timeline.items[i];
  const lt = t - it.start;
  drawVisual(ctx, W, H, it, lt, bank, project, opts.noFade);
  const trans = project.transition || 'crossfade';
  const next = timeline.items[i + 1];
  const into = it.start + it.dur - t;
  if (next && trans !== 'cut' && into < TRANSITION) {
    const a = 1 - into / TRANSITION;
    ctx.save();
    if (trans === 'crossfade') { ctx.globalAlpha = a; drawVisual(ctx, W, H, next, -into, bank, project); }
    else if (trans === 'slide') { ctx.translate(W * (1 - easeInOut(a)), 0); drawVisual(ctx, W, H, next, -into, bank, project); }
    else if (trans === 'fade-black') { ctx.globalAlpha = a < 0.5 ? a * 2 : 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); if (a >= 0.5) { ctx.globalAlpha = (a - 0.5) * 2; drawVisual(ctx, W, H, next, -into, bank, project); } }
    ctx.restore();
  }
  // gentle vignette for a finished look
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  if (project.captions && project.captions.enabled !== false) {
    const portrait = H > W;
    const cap = activeCaption(it, t, portrait ? 3 : 6);
    if (cap) drawCaption(ctx, W, H, cap, project.captions.style || 'bold', portrait);
  }
  if (project.fadeInOut !== false && !opts.noFade) {
    const edge = Math.min(t / 0.5, (timeline.duration - t) / 0.6);
    if (edge < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, edge)})`; ctx.fillRect(0, 0, W, H); }
  }
}
function easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

// Mix every scene's voice (and optional music bed) into one stereo buffer.
export async function mixAudio(project, timeline, bank) {
  const length = Math.max(1, Math.ceil(timeline.duration * SAMPLE_RATE));
  const oc = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const voiceBus = oc.createGain(); voiceBus.gain.value = 1; voiceBus.connect(oc.destination);
  for (const it of timeline.items) {
    const buf = it.scene.audioKey ? bank.audio.get(it.scene.audioKey) : null;
    if (!buf) continue;
    const src = oc.createBufferSource(); src.buffer = buf; src.connect(voiceBus); src.start(it.speechStart);
  }
  const m = project.music;
  const mbuf = m && m.key ? bank.audio.get(m.key) : null;
  if (mbuf) {
    const g = oc.createGain();
    const vol = (m.volume == null ? 0.25 : m.volume);
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(vol, Math.min(1, timeline.duration / 4));
    g.gain.setValueAtTime(vol, Math.max(0, timeline.duration - 2));
    g.gain.linearRampToValueAtTime(0, timeline.duration);
    const src = oc.createBufferSource(); src.buffer = mbuf; src.loop = true; src.connect(g); g.connect(oc.destination); src.start(0);
  }
  const out = await oc.startRendering();
  // Peak-normalise to about -1 dBFS so quiet voices come out at a good level (gain capped at 4x).
  let peak = 0;
  for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; } }
  if (peak > 0.0001) {
    const k = Math.min(4, 0.891 / peak);
    if (Math.abs(k - 1) > 0.02) for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  }
  return out;
}
