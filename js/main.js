/* ============================================================
   LifeCre8 — main.js  v1.12.0
   What’s in this reset:
   - Restores stable, centered grid + right-hand assistant layout
   - Seeds with ONLY the “Daily Brief” tile
   - New density behavior:
       • Compact   = multi-column grid (old layout)
       • Comfortable = each tile full width (still respects assistant on/off)
   - Solid settings/expand/remove + RSS loader
   - Assistant toggle preserved (no layout glitches)
============================================================ */

/* ===== Keys & Version ===== */
const K_SECTIONS   = "lifecre8.sections";
const K_ASSIST_ON  = "lifecre8.assistantOn";
const K_CHAT       = "lifecre8.chat";
const K_VERSION    = "lifecre8.version";
const K_PREFS      = "lifecre8.prefs";
const DATA_VERSION = 6;

/* ===== State ===== */
let sections    = JSON.parse(localStorage.getItem(K_SECTIONS)  || "[]");
let assistantOn = localStorage.getItem(K_ASSIST_ON) === null ? true : JSON.parse(localStorage.getItem(K_ASSIST_ON));
let chat        = JSON.parse(localStorage.getItem(K_CHAT)      || "[]");
if (!chat.length) chat = [{ role:'ai', text:"Hi! I'm your AI Assistant. Ask me anything." }];

let prefs = JSON.parse(localStorage.getItem(K_PREFS) || "{}");
if (!prefs.theme)   prefs.theme   = "solar";
if (!prefs.density) prefs.density = "compact"; // default to compact (old layout)

const $  = (q, r=document) => r.querySelector(q);
const $$ = (q, r=document) => Array.from(r.querySelectorAll(q));
const uid = () => Math.random().toString(36).slice(2);

/* ===== DOM contracts (created if missing) ===== */
function ensureShell() {
  // .app
  let app = $('.app');
  if (!app) {
    app = document.createElement('div');
    app.className = 'app';
    document.body.appendChild(app);
  }

  // Header (lightweight; your HTML may already render buttons)
  if (!$('#toolbar')) {
    const bar = document.createElement('div');
    bar.id = 'toolbar';
    bar.innerHTML = `
      <div class="brand">LifeCre8</div>
      <div class="tools">
        <button id="addTileBtnTop" class="btn">Add Tile</button>
        <button id="globalSettingsBtn" class="btn">Settings</button>
        <button id="assistantToggle" class="btn ${assistantOn?'primary':''}">AI Assistant</button>
      </div>
    `;
    app.appendChild(bar);
  }

  // Layout: left grid + right assistant
  if (!$('#layout')) {
    const layout = document.createElement('div');
    layout.id = 'layout';
    layout.innerHTML = `
      <main id="gridWrap"><div id="grid"></div></main>
      <aside id="assistantPanel">
        <div class="chat" id="assistantChat"></div>
        <form id="chatForm" class="chatForm">
          <input id="chatInput" class="input" placeholder="Ask me anything…"/>
          <button class="btn primary">Send</button>
        </form>
      </aside>
    `;
    $('.app').appendChild(layout);
  }

  // Modal + Backdrop for settings
  if (!$('#modal')) {
    const m = document.createElement('div');
    m.id = 'modal';
    m.className = 'modal hidden';
    document.body.appendChild(m);
  }
  if (!$('#fsBackdrop')) {
    const b = document.createElement('div');
    b.id = 'fsBackdrop';
    document.body.appendChild(b);
  }
}

/* ===== Presets ===== */
const RSS_PRESETS = {
  uk: [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://www.theguardian.com/uk-news/rss",
  ],
};

/* ===== Seed ===== */
function rssLoadingMarkup() {
  return `
    <div class="rss" data-rss>
      <div class="rss-controls"><button class="btn sm rss-refresh">Refresh</button></div>
      <div class="muted">Loading…</div>
    </div>
  `;
}
function rssListMarkup(items) {
  const list = (items || []).map(i => `
    <div class="rss-item">
      ${i.image ? `<img src="${i.image}" alt="">` : `<div class="img ph"></div>`}
      <div class="meta">
        <a href="${i.link}" target="_blank" rel="noopener">${i.title}</a>
        <div class="muted">${i.source || ''} ${i.time ? `— ${i.time}`:''}</div>
      </div>
    </div>
  `).join("");
  return `
    <div class="rss" data-rss>
      <div class="rss-controls"><button class="btn sm rss-refresh">Refresh</button></div>
      ${list}
    </div>
  `;
}
function rssErrorMarkup() {
  return `
    <div class="rss" data-rss>
      <div class="rss-controls"><button class="btn sm rss-refresh">Refresh</button></div>
      <div class="muted">Couldn’t load news right now. Try Refresh in a moment.</div>
    </div>
  `;
}

function defaultSections() {
  // Only the Daily Brief tile
  return [
    { id: uid(), type:"rss", title:"Daily Brief", meta:{ feeds: RSS_PRESETS.uk }, content: rssLoadingMarkup() }
  ];
}

/* ===== Versioning / Seed ===== */
function ensureVersion() {
  const current = parseInt(localStorage.getItem(K_VERSION) || "0", 10);
  if (!sections.length) {
    sections = defaultSections();
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
  }
  if (current !== DATA_VERSION) {
    localStorage.setItem(K_VERSION, String(DATA_VERSION));
  }
}

/* ===== Rendering ===== */
function tileContentFor(section) {
  switch (section.type) {
    case "rss": return section.content || rssLoadingMarkup();
    case "web": {
      const url = section.meta?.url || "https://example.com";
      const host = (()=>{ try { return new URL(url).hostname; } catch { return url; }})();
      return `
        <div class="web-tile" data-web data-url="${url}">
          <div class="web-preview">
            <div class="web-header">
              <img class="web-favicon" src="https://www.google.com/s2/favicons?domain=${host}&sz=32" alt="">
              <div>
                <div class="web-title">${host}</div>
                <div class="web-host">${url}</div>
              </div>
            </div>
            <div class="web-actions">
              <a class="btn sm" href="${url}" target="_blank" rel="noopener">Open</a>
            </div>
            <div class="muted" style="margin-top:6px">Some sites block embedding. Use Open to view.</div>
          </div>
        </div>
      `;
    }
    default:   return section.content || "Empty";
  }
}
function cardHeaderActions(id){
  return `
    <div class="actions">
      <button class="btn sm settingsBtn" data-id="${id}">Settings</button>
      <button class="btn sm expandBtn" data-id="${id}">⤢ Expand</button>
      <button class="btn sm removeBtn" data-id="${id}">Remove</button>
    </div>
  `;
}
function render() {
  const grid = $('#grid');
  grid.innerHTML = "";

  sections.forEach(s => {
    const card = document.createElement("section");
    card.className = "card";
    card.dataset.id = s.id;
    card.dataset.type = s.type || "tile";
    card.innerHTML = `
      <h3><span class="title">${s.title}</span>${cardHeaderActions(s.id)}</h3>
      <div class="content">${tileContentFor(s)}</div>
    `;
    grid.appendChild(card);
  });

  // load RSS after render
  $$('.card[data-type="rss"]').forEach(card=>{
    const id = card.dataset.id;
    const s  = sections.find(x=>x.id===id);
    const feeds = s?.meta?.feeds || RSS_PRESETS.uk;
    loadRssInto(card, feeds);
  });
}

/* ===== RSS loader ===== */
function loadRssInto(card, feeds, attempt=1) {
  const content = card.querySelector(".content");
  if (!feeds || !feeds.length || !content) return;

  const url = `/api/rss?full=1&url=${encodeURIComponent(feeds[0])}`;
  fetch(url)
    .then(r=>r.json())
    .then(data=>{
      const items = (data.items||[]).slice(0,10);
      content.innerHTML = rssListMarkup(items);
    })
    .catch(()=>{
      if (attempt < 2) setTimeout(()=>loadRssInto(card, feeds, attempt+1), 1000);
      else content.innerHTML = rssErrorMarkup();
    });
}

/* ===== Assistant ===== */
function updateAssistant() {
  const panel = $('#assistantPanel');
  const toggle = $('#assistantToggle');
  if (!panel || !toggle) return;

  panel.classList.toggle('show', assistantOn);
  toggle.classList.toggle('primary', assistantOn);
  document.body.classList.toggle('assistant-off', !assistantOn);
  localStorage.setItem(K_ASSIST_ON, JSON.stringify(assistantOn));
}

function renderChat(){
  const log = $('#assistantChat');
  if (!log) return;
  log.innerHTML = "";
  chat.forEach(m=>{
    const d = document.createElement("div");
    d.className = `msg ${m.role}`;
    d.textContent = m.text;
    log.appendChild(d);
  });
  log.scrollTop = log.scrollHeight;
}
function addChat(role, text){
  chat.push({role, text});
  localStorage.setItem(K_CHAT, JSON.stringify(chat));
  renderChat();
}
function bindChat() {
  const form = $('#chatForm');
  const input = $('#chatInput');
  if (!form || !input) return;

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addChat('user', text);
    input.value = '';
    try {
      const r = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ q: text, messages: chat })
      });
      const j = await r.json();
      addChat('ai', j.message || '…');
    } catch {
      addChat('ai', "I couldn't reach the chat service right now.");
    }
  });
}

/* ===== Settings modal ===== */
function openModal(html){
  const modal = $('#modal');
  if (!modal) return;
  modal.innerHTML = `<div class="modal-card">${html}</div>`;
  modal.classList.remove('hidden');
  modal.classList.add('show');
  document.body.style.overflow = 'hidden';
}
function closeModal(){
  const modal = $('#modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('show');
  modal.innerHTML = '';
  document.body.style.overflow = '';
}

/* ===== Delegated grid events ===== */
function bindGridEvents(){
  const grid = $('#grid');
  const backdrop = $('#fsBackdrop');

  // Expand
  grid.addEventListener('click', (e)=>{
    const btn = e.target.closest('.expandBtn');
    if (!btn) return;
    const card = btn.closest('.card');
    card.classList.toggle('card-full');
    document.body.style.overflow = card.classList.contains('card-full') ? 'hidden' : '';
    backdrop.classList.toggle('show', card.classList.contains('card-full'));
    btn.textContent = card.classList.contains('card-full') ? 'Close' : '⤢ Expand';
  });

  // Remove
  grid.addEventListener('click', (e)=>{
    const btn = e.target.closest('.removeBtn');
    if (!btn) return;
    const id = btn.dataset.id;
    sections = sections.filter(s=>s.id!==id);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    render();
  });

  // Settings (per tile – only RSS has options right now)
  grid.addEventListener('click', (e)=>{
    const btn = e.target.closest('.settingsBtn');
    if (!btn) return;
    const id = btn.dataset.id;
    const s = sections.find(x=>x.id===id);
    if (!s) return;

    let fields = '';
    if (s.type === 'rss') {
      const feeds = (s.meta?.feeds || RSS_PRESETS.uk).join(',');
      fields = `
        <h2>Settings — ${s.title}</h2>
        <div class="field">
          <label>RSS feeds (comma separated; first is used)</label>
          <input class="input" id="set_feeds" value="${feeds}">
        </div>
        <div class="actions">
          <button class="btn" data-action="cancel">Cancel</button>
          <button class="btn primary" data-action="save">Save</button>
        </div>
      `;
    } else if (s.type === 'web') {
      const url = s.meta?.url || '';
      fields = `
        <h2>Settings — ${s.title}</h2>
        <div class="field">
          <label>URL</label>
          <input class="input" id="set_url" value="${url}">
        </div>
        <div class="actions">
          <button class="btn" data-action="cancel">Cancel</button>
          <button class="btn primary" data-action="save">Save</button>
        </div>
      `;
    } else {
      fields = `
        <h2>Settings — ${s.title}</h2>
        <div class="muted">No settings available for this tile.</div>
        <div class="actions">
          <button class="btn primary" data-action="cancel">Close</button>
        </div>
      `;
    }

    openModal(fields);

    $('#modal').addEventListener('click', (ev)=>{
      const cancel = ev.target.closest('[data-action="cancel"]');
      const save   = ev.target.closest('[data-action="save"]');
      if (cancel) { closeModal(); }
      if (save) {
        if (s.type === 'rss') {
          const feeds = ($('#set_feeds').value || '').split(',').map(x=>x.trim()).filter(Boolean);
          s.meta = {...(s.meta||{}), feeds: feeds.length ? feeds : RSS_PRESETS.uk};
          s.content = rssLoadingMarkup();
        } else if (s.type === 'web') {
          const url = ($('#set_url').value || '').trim();
          s.meta = {...(s.meta||{}), url};
          s.content = tileContentFor(s);
        }
        localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
        closeModal();
        render();
      }
    }, { once:true });
  });

  // Backdrop & Esc
  $('#fsBackdrop').addEventListener('click', ()=>{
    const open = $('.card.card-full');
    if (!open) return;
    open.classList.remove('card-full');
    document.body.style.overflow = '';
    $('#fsBackdrop').classList.remove('show');
    open.querySelector('.expandBtn').textContent = '⤢ Expand';
  });
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && $('.card.card-full')) {
      const open = $('.card.card-full');
      open.classList.remove('card-full');
      document.body.style.overflow = '';
      $('#fsBackdrop').classList.remove('show');
      open.querySelector('.expandBtn').textContent = '⤢ Expand';
    }
  });
}

/* ===== Toolbar events ===== */
function bindToolbar() {
  $('#assistantToggle')?.addEventListener('click', ()=>{
    assistantOn = !assistantOn;
    updateAssistant();
  });

  $('#globalSettingsBtn')?.addEventListener('click', ()=>{
    const html = `
      <h2>Global Settings</h2>
      <div class="field">
        <label>Theme</label>
        <select class="input" id="g_theme">
          <option value="solar" ${prefs.theme==='solar'?'selected':''}>Solar (Dark)</option>
          <option value="ice" ${prefs.theme==='ice'?'selected':''}>Ice (Light)</option>
        </select>
      </div>
      <div class="field">
        <label>Density</label>
        <select class="input" id="g_density">
          <option value="compact" ${prefs.density==='compact'?'selected':''}>Compact (grid)</option>
          <option value="comfortable" ${prefs.density==='comfortable'?'selected':''}>Comfortable (full width)</option>
        </select>
      </div>
      <div class="actions">
        <button class="btn" data-action="cancel">Cancel</button>
        <button class="btn" id="resetLayout">Reset Layout</button>
        <button class="btn primary" data-action="save">Save</button>
      </div>
    `;
    openModal(html);

    $('#modal').addEventListener('click', (ev)=>{
      const cancel = ev.target.closest('[data-action="cancel"]');
      const save   = ev.target.closest('[data-action="save"]');
      const reset  = ev.target.closest('#resetLayout');
      if (cancel) closeModal();
      if (reset) {
        localStorage.removeItem(K_SECTIONS);
        localStorage.removeItem(K_VERSION);
        location.reload();
      }
      if (save) {
        prefs.theme   = $('#g_theme').value;
        prefs.density = $('#g_density').value;
        localStorage.setItem(K_PREFS, JSON.stringify(prefs));
        applyThemeAndDensity();
        closeModal();
      }
    }, { once:true });
  });

  // Simple Add Tile: support a URL → web tile (kept minimal on purpose)
  $('#addTileBtnTop')?.addEventListener('click', ()=>{
    const url = prompt("Paste a URL to pin as a tile (or Cancel):");
    if (!url) return;
    let safe = url.trim();
    if (!/^https?:\/\//i.test(safe)) safe = 'https://' + safe;
    const t = {
      id: uid(),
      type: 'web',
      title: (new URL(safe)).hostname,
      meta: { url: safe },
      content: '' // will be rendered by tileContentFor
    };
    t.content = tileContentFor(t);
    sections.unshift(t);
    localStorage.setItem(K_SECTIONS, JSON.stringify(sections));
    render();
  });
}

/* ===== Theme & Density ===== */
function applyThemeAndDensity(){
  document.body.classList.toggle('theme-ice', prefs.theme === 'ice');
  // Density:
  //  - compact = multi-column grid (old layout)
  //  - comfortable = full-width cards
  document.body.classList.toggle('density-compact',     prefs.density === 'compact');
  document.body.classList.toggle('density-comfortable', prefs.density === 'comfortable');
}

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', ()=>{
  ensureShell();
  ensureVersion();
  applyThemeAndDensity();
  updateAssistant();
  bindChat();
  bindGridEvents();
  bindToolbar();
  render();
});
