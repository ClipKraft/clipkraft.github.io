// Owner tools: edit the public site settings (settings.json) and see the projects saved in this browser.
// This page is NOT a private admin area: the site is static, so anyone can open it. It can only change the
// live site with a GitHub token that has write access to the repository, and that token lives only in the
// owner's own browser. A real admin area (user list, analytics) needs a server; see README "Next steps".
import { applyBrand, settingsReady } from './brand.js';
import { BRAND, GITHUB_REPO } from './config.js';
import * as ai from './ai.js';
import * as store from './store.js';
import { buildTimeline } from './engine.js';

applyBrand();
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = $('#root');
const TOKEN_KEY = 'ck-admin-github-token';
function toast(msg, kind = '') { const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg; $('#toasts').appendChild(el); setTimeout(() => el.remove(), 5000); }
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function dashboard() {
  const s = Object.assign({ brandName: '', tagline: '', accent: '', accent2: '', banner: '', enableVideo: true }, await settingsReady);
  const projects = await store.listProjects();
  let est = null; try { est = await navigator.storage.estimate(); } catch (e) { /* optional */ }
  const token = localStorage.getItem(TOKEN_KEY) || '';
  root.innerHTML = `
  <div class="panel-title"><div><h2>Owner tools</h2><p>Edit ${esc(BRAND.name)}'s public site settings and see the projects saved in this browser.</p></div></div>
  <div class="notice" style="margin-bottom:14px"><b>Not a private area.</b> ${esc(BRAND.name)} is a static site, so anyone can open this page. Only someone with a GitHub token that can write to the <b>${esc(GITHUB_REPO.owner)}/${esc(GITHUB_REPO.repo)}</b> repository can publish changes. Sign-in and passwords are handled entirely by Puter; ${esc(BRAND.name)} never sees or stores anyone's password.</div>

  <div class="card">
    <h3>Site settings</h3>
    <p class="hint" style="margin:-4px 0 14px">These change the live site for every visitor. Leave a field empty to use the default from <code>js/config.js</code>.</p>
    <div class="row">
      <div class="field"><label>Brand name</label><input type="text" id="sName" placeholder="${esc(BRAND.name)}" value="${esc(s.brandName)}"></div>
      <div class="field"><label>Tagline</label><input type="text" id="sTag" placeholder="${esc(BRAND.tagline)}" value="${esc(s.tagline)}"></div>
    </div>
    <div class="row">
      <div class="field" style="flex:0 1 160px"><label>Accent colour 1</label><input type="color" id="sAcc" value="${esc(s.accent || '#7c5cff')}" style="width:100%;height:42px;border-radius:10px;border:1px solid var(--line2);background:var(--bg2)"></div>
      <div class="field" style="flex:0 1 160px"><label>Accent colour 2</label><input type="color" id="sAcc2" value="${esc(s.accent2 || '#ff5c8a')}" style="width:100%;height:42px;border-radius:10px;border:1px solid var(--line2);background:var(--bg2)"></div>
      <div class="field" style="flex:1 1 200px"><label>Preview</label><div id="sPrev" style="height:42px;border-radius:10px;display:grid;place-items:center;font-weight:700;color:#fff"></div></div>
    </div>
    <div class="field"><label>Announcement banner (shown at the top of every page; empty = none)</label><input type="text" id="sBan" placeholder="e.g. New: Hindi voices are here!" value="${esc(s.banner)}"></div>
    <label class="toggle" style="margin:6px 0 16px"><input type="checkbox" id="sVid" ${s.enableVideo !== false ? 'checked' : ''}> AI video clips enabled for users</label>
    <div class="row">
      <button class="btn primary" id="btnPublish">🚀 Publish to live site</button>
      <button class="btn" id="btnDl">⬇ Download settings.json</button>
      <button class="btn ghost" id="btnReset">Reset to defaults</button>
    </div>
    <details style="margin-top:14px"><summary class="hint" style="cursor:pointer">Publishing setup (GitHub token)</summary>
      <p class="hint">“Publish” saves <code>settings.json</code> straight into the <b>${esc(GITHUB_REPO.owner)}/${esc(GITHUB_REPO.repo)}</b> repository, and GitHub Pages updates the site in about a minute.
      It needs a GitHub <b>fine-grained personal access token</b> with access to only that repository and <b>Contents: Read and write</b> (github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens).
      The token is stored only in this browser, never in the site's code.</p>
      <div class="row"><div class="field" style="flex:1 1 260px"><input type="text" id="tok" placeholder="github_pat_…" value="${token ? '••••••••••••' + esc(token.slice(-4)) : ''}" autocomplete="off"></div>
      <div class="field" style="flex:0 0 auto"><button class="btn sm" id="btnTok">Save token</button></div>
      <div class="field" style="flex:0 0 auto"><button class="btn sm ghost danger" id="btnTokDel">Forget token</button></div></div>
      <p class="hint">No token? Use “Download settings.json”, then on github.com open the repository → <b>Add file → Upload files</b> → drop the file → Commit.</p>
    </details>
  </div>

  <div class="card">
    <h3>Your projects (this browser)</h3>
    <p class="hint" style="margin:-4px 0 12px">${projects.length} project${projects.length === 1 ? '' : 's'}${est ? ` · ${(est.usage / 1048576).toFixed(1)} MB of media stored` : ''}. Exported MP4s are downloaded to your device; they aren't kept here.</p>
    ${projects.length ? projects.map((p) => { const tl = buildTimeline(p); const imgs = p.scenes.filter((x) => x.imageKey).length; const vo = p.scenes.filter((x) => x.audioKey).length; const clips = p.scenes.filter((x) => x.videoKey).length;
      return `<div class="proj-item" style="cursor:default"><div class="grow"><b>${esc(p.name || 'Untitled')}</b>
        <small>${p.format} · ${p.scenes.length} scenes · ${fmtTime(tl.duration)} · ${imgs} images · ${clips} clips · ${vo} voice clips · updated ${new Date(p.updatedAt).toLocaleString()}</small></div>
        <a class="btn sm" href="app.html?project=${encodeURIComponent(p.id)}">Open</a></div>`; }).join('') : '<div class="empty-state">No projects in this browser yet.</div>'}
  </div>

  <div class="card">
    <h3>Your AI usage this month</h3>
    <div id="usage" class="hint">Sign in with Puter to see your own usage. <button class="btn sm" id="btnUsage">Show my usage</button></div>
  </div>

  <div class="notice"><b>What this page can't show.</b> ${esc(BRAND.name)} has no server, which is what keeps it free to run. Each user's projects live in their own browser and their AI usage is billed to their own Puter account, so other users, their projects and their usage aren't visible here. A real admin area needs a server; it's on the roadmap in the README.</div>`;

  const val = () => ({ brandName: $('#sName').value.trim(), tagline: $('#sTag').value.trim(), accent: $('#sAcc').value, accent2: $('#sAcc2').value, banner: $('#sBan').value.trim(), enableVideo: $('#sVid').checked });
  const prev = () => { const v = val(); $('#sPrev').style.background = `linear-gradient(135deg, ${v.accent}, ${v.accent2})`; $('#sPrev').textContent = v.brandName || BRAND.name; };
  root.querySelectorAll('input').forEach((i) => i.addEventListener('input', prev)); prev();
  const json = () => JSON.stringify(val(), null, 2) + '\n';
  $('#btnDl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json()], { type: 'application/json' })); a.download = 'settings.json'; a.click(); };
  $('#btnReset').onclick = () => { $('#sName').value = ''; $('#sTag').value = ''; $('#sAcc').value = '#7c5cff'; $('#sAcc2').value = '#ff5c8a'; $('#sBan').value = ''; $('#sVid').checked = true; prev(); toast('Defaults filled in. Publish to apply.'); };
  $('#btnTok').onclick = () => { const t = $('#tok').value.trim(); if (!t || t.startsWith('•')) return toast('Paste a token first.', 'err'); localStorage.setItem(TOKEN_KEY, t); $('#tok').value = '••••••••••••' + t.slice(-4); toast('Token saved in this browser.', 'ok'); };
  $('#btnTokDel').onclick = () => { localStorage.removeItem(TOKEN_KEY); $('#tok').value = ''; toast('Token removed from this browser.'); };
  $('#btnPublish').onclick = async (e) => {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) { toast('Add a GitHub token under “Publishing setup” first, or use Download.', 'err'); root.querySelector('details').open = true; return; }
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Publishing…';
    try {
      const api = `https://api.github.com/repos/${GITHUB_REPO.owner}/${GITHUB_REPO.repo}/contents/settings.json`;
      const h = { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json' };
      const cur = await fetch(`${api}?ref=${GITHUB_REPO.branch}`, { headers: h, cache: 'no-store' });
      const sha = cur.ok ? (await cur.json()).sha : undefined;
      const body = { message: 'Update site settings', content: btoa(unescape(encodeURIComponent(json()))), branch: GITHUB_REPO.branch };
      if (sha) body.sha = sha;
      const r = await fetch(api, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`GitHub said ${r.status}: ${(await r.json().catch(() => ({}))).message || 'error'}`);
      toast('Published! The live site updates in about a minute.', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    b.disabled = false; b.textContent = '🚀 Publish to live site';
  };
  $('#btnUsage').onclick = async () => {
    try {
      if (!(await ai.isSignedIn())) await ai.signIn();
      const u = await (await ai.puterReady()).auth.getMonthlyUsage();
      $('#usage').innerHTML = `<pre style="white-space:pre-wrap;margin:0;font-size:12px;max-height:240px;overflow:auto">${esc(JSON.stringify(u, null, 2))}</pre>`;
    } catch (e) { $('#usage').textContent = 'Usage is also shown on your Puter dashboard: puter.com/dashboard'; }
  };
}

dashboard();
