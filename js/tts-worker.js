// Runs the free on-device voice model in a background thread so the page stays responsive.
import { KokoroTTS } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';

let ttsPromise = null;
const files = {};
function load() {
  if (!ttsPromise) {
    ttsPromise = KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p) => {
        if (p.status === 'progress' && p.total) files[p.file] = [p.loaded, p.total];
        const v = Object.values(files);
        const total = v.reduce((a, x) => a + x[1], 0);
        if (total) postMessage({ type: 'progress', value: v.reduce((a, x) => a + x[0], 0) / total });
      },
    });
    ttsPromise.catch(() => { ttsPromise = null; });
  }
  return ttsPromise;
}

onmessage = async (e) => {
  const { id, text, voice } = e.data;
  try {
    const tts = await load();
    postMessage({ type: 'progress', value: 1 });
    const audio = await tts.generate(text, { voice });
    postMessage({ id, type: 'done', blob: audio.toBlob() });
  } catch (err) {
    postMessage({ id, type: 'error', message: String((err && err.message) || err) });
  }
};
