// MP4 export in the browser. Primary path: WebCodecs (hardware H.264 + AAC/Opus) muxed into MP4.
// Fallback for browsers without WebCodecs: real-time MediaRecorder capture.
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';
import { FPS, SAMPLE_RATE, drawFrame, mixAudio, videosAt, canvasSize } from './engine.js';

const VIDEO_CANDIDATES = [
  { codec: 'avc1.640034', mux: 'avc' }, // High 5.2
  { codec: 'avc1.640028', mux: 'avc' }, // High 4.0
  { codec: 'avc1.4d0028', mux: 'avc' }, // Main 4.0
  { codec: 'avc1.42003e', mux: 'avc' }, // Baseline 6.2
  { codec: 'avc1.42001f', mux: 'avc' },
  { codec: 'vp09.00.40.08', mux: 'vp9' },
  { codec: 'av01.0.08M.08', mux: 'av1' },
];

export async function pickVideoCodec(w, h, bitrate) {
  if (!('VideoEncoder' in window)) return null;
  for (const c of VIDEO_CANDIDATES) {
    for (const hw of ['prefer-hardware', 'no-preference']) {
      const cfg = { codec: c.codec, width: w, height: h, bitrate, framerate: FPS, hardwareAcceleration: hw };
      if (c.mux === 'avc') cfg.avc = { format: 'avc' };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return { ...c, config: r.config }; } catch (e) { /* try next */ }
    }
  }
  return null;
}
export async function pickAudioCodec() {
  if (!('AudioEncoder' in window)) return null;
  for (const c of [{ codec: 'mp4a.40.2', mux: 'aac' }, { codec: 'opus', mux: 'opus' }]) {
    const cfg = { codec: c.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 192000 };
    try { const r = await AudioEncoder.isConfigSupported(cfg); if (r.supported) return { ...c, config: r.config }; } catch (e) { /* next */ }
  }
  return null;
}

function seekVideo(v, time) {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - time) < 0.001 && v.readyState >= 2) return resolve();
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); resolve(); };
    const to = setTimeout(done, 1500);
    v.addEventListener('seeked', done);
    v.currentTime = time;
  });
}

export async function exportVideo({ project, timeline, bank, height = 1080, onProgress, signal }) {
  // height is the short side (1080 = 1080p) for both 16:9 and 9:16
  const { w: W, h: H } = canvasSize(project.format, height);
  const bitrate = height >= 1080 ? 10_000_000 : 5_000_000;
  onProgress && onProgress({ phase: 'Mixing audio', p: 0 });
  const audioBuf = await mixAudio(project, timeline, bank);
  const vCodec = await pickVideoCodec(W, H, bitrate);
  const aCodec = await pickAudioCodec();
  if (!vCodec) return exportRealtime({ project, timeline, bank, W, H, audioBuf, onProgress, signal });

  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: vCodec.mux, width: W, height: H, frameRate: FPS },
    audio: aCodec ? { codec: aCodec.mux, numberOfChannels: 2, sampleRate: SAMPLE_RATE } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let encErr = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
  venc.configure({ ...vCodec.config, latencyMode: 'quality' });

  const totalFrames = Math.ceil(timeline.duration * FPS);
  const t0 = performance.now();
  for (let f = 0; f < totalFrames; f++) {
    if (signal && signal.aborted) { venc.close(); throw new DOMException('Export cancelled', 'AbortError'); }
    if (encErr) throw encErr;
    const t = f / FPS;
    for (const { video, time } of videosAt(timeline, t, bank)) await seekVideo(video, time);
    drawFrame(ctx, W, H, project, timeline, bank, t);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(frame, { keyFrame: f % (FPS * 2) === 0 });
    frame.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (f % 10 === 0) {
      const el = (performance.now() - t0) / 1000;
      const eta = f > 0 ? el / f * (totalFrames - f) : 0;
      onProgress && onProgress({ phase: 'Rendering video', p: f / totalFrames, eta });
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await venc.flush(); venc.close();
  if (encErr) throw encErr;

  if (aCodec) {
    onProgress && onProgress({ phase: 'Encoding audio', p: 1 });
    let aerr = null;
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { aerr = e; } });
    aenc.configure(aCodec.config);
    const L = audioBuf.getChannelData(0), R = audioBuf.getChannelData(1);
    const N = 1024 * 4;
    for (let i = 0; i < audioBuf.length; i += N) {
      const n = Math.min(N, audioBuf.length - i);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / SAMPLE_RATE), data });
      aenc.encode(ad); ad.close();
      while (aenc.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 2));
    }
    await aenc.flush(); aenc.close();
    if (aerr) throw aerr;
  }
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  return { blob, ext: 'mp4', width: W, height: H, duration: timeline.duration, videoCodec: vCodec.codec, audioCodec: aCodec ? aCodec.codec : 'none' };
}

// Fallback: play the timeline in real time and record it.
async function exportRealtime({ project, timeline, bank, W, H, audioBuf, onProgress, signal }) {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });
  const ac = new AudioContext({ sampleRate: SAMPLE_RATE });
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource(); src.buffer = audioBuf; src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  const mime = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const parts = []; rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise((r) => { rec.onstop = r; });
  for (const v of bank.videos.values()) if (v) { v.loop = true; v.play().catch(() => {}); }
  rec.start(500); const start = ac.currentTime + 0.05; src.start(start);
  await new Promise((resolve) => {
    const tick = () => {
      const t = ac.currentTime - start;
      if ((signal && signal.aborted) || t >= timeline.duration) return resolve();
      drawFrame(ctx, W, H, project, timeline, bank, Math.max(0, t));
      onProgress && onProgress({ phase: 'Recording (real time)', p: Math.max(0, t) / timeline.duration });
      requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop(); await stopped; ac.close();
  for (const v of bank.videos.values()) if (v) v.pause();
  if (signal && signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
  const type = mime.split(';')[0] || 'video/webm';
  return { blob: new Blob(parts, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm', width: W, height: H, duration: timeline.duration, videoCodec: 'recorder', audioCodec: '' };
}
