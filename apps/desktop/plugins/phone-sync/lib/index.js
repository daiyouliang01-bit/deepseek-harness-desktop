/**
 * @dshd/phone-sync — phone access for DeepSeek Harness Desktop.
 *
 * Merges the persisted `phn` (Cloudflare quick tunnel) and `phv-3` (mobile
 * view: session list / detail / send / SSE live) dynamic plugins into one
 * host-side plugin. Key adaptation for desktop:
 *
 *   - UPSTREAM is resolved from `process.env.DSH_APP_PORT` (the desktop app
 *     spawns dsh with the actual port it bound) instead of the hard-coded
 *     :3080 of the original web-GUI plugin. Falls back to 3080 for the plain
 *     `dsh web` case.
 *   - The mobile routes live under `/phn/*` (non-/api), so they are reachable
 *     through the tunnel without touching the host API gateway.
 *
 * Exposed RPC (via harness.handle):
 *   phone/status → { phase, url, message, startedAt }
 *   phone/start  → ensure cloudflared, open a quick tunnel, wait up to 16s
 *   phone/stop   → kill the tunnel
 */

export default {
  inject: ['webServer', 'shell', 'timer', 'sessionQuery', 'workspaceRegistry', 'agents'],
  apply(ctx) {
    // Upstream the quick tunnel exposes to the public. Security (plan R1):
    // the tunnel must terminate at the PIN gate, never the bare dsh web
    // port, so the phone cannot reach /phn without the PIN. Priority:
    // DSH_PIN_GATE_PORT → DSH_APP_PORT → 3080 fallback.
    const GATE_PORT = process.env.DSH_PIN_GATE_PORT
    const APP_PORT = process.env.DSH_APP_PORT
    const UPSTREAM = `http://127.0.0.1:${GATE_PORT || APP_PORT || '3080'}`

    // Companion token (plan R30/R34): the PIN gate and the desktop main
    // process know this value; every /phn route requires it so only requests
    // that crossed OUR gate (or the desktop's control channel) are served.
    // Bare loopback /phn calls without the header are rejected.
    const COMPANION_TOKEN = process.env.DSH_COMPANION_TOKEN || ''
    function safeEqual(a, b) {
      if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
      let diff = 0
      for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
      return diff === 0
    }
    const tokenOk = (req) => COMPANION_TOKEN.length > 0 && safeEqual(String(req.headers['x-dsh-companion-token'] || ''), COMPANION_TOKEN)
    const deny = (res, msg) => { res.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: msg || 'unauthorized' })) }

    // Plan R29: refuse to point a public tunnel at a port that is not OUR
    // gate. Probes /__health?t=<token> — only our gate answers ok:true.
    const gateHealthy = async () => {
      if (!COMPANION_TOKEN) return false
      const ac = new AbortController()
      const to = setTimeout(() => ac.abort(), 4000)
      try {
        const r = await fetch(`${UPSTREAM}/__health?t=${encodeURIComponent(COMPANION_TOKEN)}`, { signal: ac.signal })
        if (!r.ok) return false
        const j = await r.json()
        return !!(j && j.ok === true && j.app === 'dsh-pin-gate')
      } catch (_e) { return false }
      finally { clearTimeout(to) }
    }

    // ─────────────────────────── tunnel (phn) ───────────────────────────
    const URL_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/gi
    const state = { phase: 'idle', url: null, message: null, startedAt: 0 }
    let tunnel = null
    let brew = null
    let tickStop = null
    let acc = ''
    let deadline = 0

    const status = () => ({ phase: state.phase, url: state.url, message: state.message, startedAt: state.startedAt })
    const safeKill = (p) => { if (p) { try { p.kill() } catch (_e) {} } }
    const stopAll = () => { safeKill(tunnel); safeKill(brew); tunnel = null; brew = null }
    const clearTick = () => { if (tickStop) { tickStop(); tickStop = null } }

    const foundCloudflared = async () => {
      try {
        const r = await ctx.shell.run(ctx.shell.resolve({ command: 'command -v cloudflared' }))
        return !!(r && r.exitCode === 0 && r.stdout && typeof r.stdout.text === 'string' && r.stdout.text.trim())
      } catch (_e) { return false }
    }

    const startTunnel = async () => {
      if (!(await gateHealthy())) {
        state.phase = 'idle'
        state.url = null
        state.message = 'PIN 网关不可用，已拒绝建立隧道（请确认桌面端已运行）'
        clearTick()
        return
      }
      state.phase = 'starting'
      state.url = null
      state.message = null
      state.startedAt = Date.now()
      acc = ''
      deadline = Date.now() + 20000
      const spec = ctx.shell.resolve({ command: 'cloudflared tunnel --url ' + UPSTREAM, workdir: '/' })
      tunnel = ctx.shell.start(spec)
      ensureTick()
    }

    const startInstalling = () => {
      state.phase = 'installing'
      state.message = '正在通过 Homebrew 安装 cloudflared，请稍候…'
      const spec = ctx.shell.resolve({ command: 'brew install cloudflared', workdir: '/' })
      brew = ctx.shell.start(spec)
      ensureTick()
    }

    const ensureTick = () => {
      if (!tickStop) tickStop = ctx.interval(() => { step().catch(() => {}) }, 1000)
    }

    const step = async () => {
      if (state.phase === 'installing') {
        if (brew && brew.status === 'running') return
        safeKill(brew); brew = null
        if (await foundCloudflared()) void startTunnel()
        else { state.phase = 'idle'; state.message = 'cloudflared 安装失败，请手动安装后重试'; clearTick() }
        return
      }
      if (state.phase === 'starting') {
        if (tunnel) { try { const r = tunnel.readOutput(); if (r && typeof r.delta === 'string') acc += r.delta } catch (_e) {} }
        const m = acc.match(URL_RE)
        if (m) { state.url = m[0]; state.phase = 'active'; state.message = '隧道已就绪，可扫码访问'; clearTick(); return }
        if (tunnel && (tunnel.status === 'completed' || tunnel.status === 'killed')) {
          state.phase = 'idle'; state.message = 'cloudflared 提前退出，隧道未建立'; tunnel = null; clearTick(); return
        }
        if (Date.now() > deadline) {
          stopAll(); state.phase = 'idle'; state.message = '创建隧道超时，请重试'; clearTick(); return
        }
        return
      }
      if (state.phase === 'active') {
        // Plan R21: keep monitoring after 'active' — if cloudflared dies the
        // panel must not keep showing a dead 'active' with a stale URL.
        if (tunnel && (tunnel.status === 'completed' || tunnel.status === 'killed')) {
          stopAll()
          state.phase = 'idle'
          state.url = null
          state.message = 'cloudflared 意外退出，隧道已断开，请重试'
          clearTick()
          return
        }
        return
      }
    }

    const waitActive = async (ms) => {
      const t0 = Date.now()
      while (Date.now() - t0 < ms && state.phase !== 'active' && state.phase !== 'idle') {
        await new Promise((res) => { ctx.timeout(res, 250) })
      }
    }

    // ───────────────────────── mobile view (phv-3) ──────────────────────
    const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)) }
    const plain = (res, code, text, extra) => { res.writeHead(code, { 'content-type': (extra && extra.ct) || 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(text) }
    const readBody = (req) => new Promise((resolve) => { let buf = ''; req.on('data', (c) => { buf += c }); req.on('end', () => { try { resolve(JSON.parse(buf || '{}')) } catch (_e) { resolve({}) } }); req.on('error', () => resolve({})) })
    const qp = (req) => { const raw = String(req.url || '').split('?')[1] || ''; const out = {}; if (!raw) return out; for (const pair of raw.split('&')) { const i = pair.indexOf('='); if (i < 0) { out[decodeURIComponent(pair)] = '' } else { out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1)) } } return out }

    const sQuery = ctx.get('sessionQuery')
    const wReg = ctx.get('workspaceRegistry')
    const agentsSvc = ctx.get('agents')

    const sseClients = new Set()
    function broadcast(event, data) { const line = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'; for (const res of sseClients) { try { res.write(line) } catch (_e) {} } }
    ctx.on('agent/status', (payload) => { const agent = payload && payload.agent; if (!agent) return; let sessionId = null; try { sessionId = String(agent.session && agent.session.id) } catch (_e) {}; if (sessionId) broadcast('agent-status', { sessionId, status: payload.status, time: Date.now() }) })

    const wrapId = (v) => (typeof v === 'object' && v !== null ? String(v.id || '') : String(v || ''))
    const titleOf = async (sid) => { try { const t = await sQuery.readTitle(sid); if (t && typeof t.title === 'string' && t.title) return t.title } catch (_e) {} return '' }
    const timeOf = async (sid) => { try { const r = await sQuery.readTitleSnapshot(sid); const h = r && r.header; if (h) return Number(h.time) || 0 } catch (_e) {} return 0 }
    const workspaceList = () => { const out = []; try { for (const w of wReg.list()) out.push({ id: wrapId(w.id), title: (w && w.title) || '', path: (w && w.path) || '', sessionIds: Array.isArray(w.sessionIds) ? w.sessionIds.map(wrapId) : [] }) } catch (_e) {} return out }
    const copyText = (blocks) => { if (!Array.isArray(blocks)) return ''; const out = []; for (const b of blocks) { if (b && b.type === 'text' && typeof b.text === 'string') out.push(b.text); else if (b && (b.type === 'image' || b.type === 'file')) out.push('[' + b.type + ']') } return out.join('\n') }
    const isInjectedUserText = (t) => { const s = String(t || ''); if (/<\s*system\-reminder\s*>/.test(s)) return true; if (/^\s*(Current runtime context|Runtime context\b|## Runtime context)/.test(s)) return true; return false }
    const PRE = 420, ASST_PRE = 700
    const clip = (txt, n) => { const t = String(txt || ''); return t.length > n ? { preview: t.slice(0, n) + '…', full: t, long: true } : { preview: t, full: t, long: false } }
    const surfaceAll = async (sid) => { const snap = await sQuery.readSurface(sid); const events = (snap && Array.isArray(snap.events)) ? snap.events : []; const out = []; for (const ev of events) { const d = ev && ev.data; if (!d) continue; if (ev.type === 'user/message') out.push({ role: 'user', text: copyText(d.content) }); else if (ev.type === 'assistant/message') out.push({ role: 'assistant', text: copyText(d.content) }); else if (ev.type === 'tool/result') { const nm = (d && d.tool && (d.tool.name || d.tool.fn)) || (d && d.name) || ''; if (nm) out.push({ role: 'tool', name: nm }) } } return out }
    const compactMessages = (msgs) => { const out = []; for (const m of msgs) { if (m.role === 'assistant') { const t = String(m.text || '').trim(); if (!t) continue; const c = clip(t, ASST_PRE); out.push({ role: 'assistant', text: c.preview, full: c.full, long: c.long }) } else if (m.role === 'user') { const t = String(m.text || ''); if (isInjectedUserText(t)) { out.push({ role: 'note', hidden: true }); continue } const c = clip(t, PRE); out.push({ role: 'user', text: c.preview, full: c.full, long: c.long }) } else if (m.role === 'tool') { out.push({ role: 'tool', name: m.name, text: '🔧 ' + (m.name || '工具'), full: '', long: false }) } } return out }

    const ws = ctx.get('webServer')
    if (!ws) return
    const routes = []

    routes.push(ws.register({ kind: 'exact', path: '/phn/api/sessions', handler: async (req, res) => {
      if (!tokenOk(req)) { deny(res, 'unauthorized'); return }
      try {
        const records = await sQuery.listSessions()
        const sessions = []
        for (const rec of records) {
          const sid = wrapId(rec.header && rec.header.id)
          if (!sid) continue
          sessions.push({ id: sid, time: (rec.header && rec.header.time) || 0, live: !!rec.live })
        }
        // Batch title read — one call for all sessions (no per-session IO).
        const titleResults = await sQuery.readTitleSnapshots(sessions.map((s) => s.id))
        const titleById = new Map()
        for (const r of titleResults) {
          const sid = wrapId(r && r.sessionId)
          if (!sid || r.status !== 'fulfilled') continue
          // r.value: SessionTitleObservation { session, title? }
          const t = r.value && r.value.title
          const titleText = (t && typeof t === 'object' && t.title) || (typeof t === 'string' ? t : '')
          titleById.set(sid, titleText || '')
        }
        for (const s of sessions) s.title = titleById.get(s.id) || ''
        json(res, 200, { workspaces: workspaceList(), sessions })
      } catch (e) { json(res, 500, { error: String((e && e.message) || e) }) }
    } }))
    routes.push(ws.register({ kind: 'exact', path: '/phn/api/surface', handler: async (req, res) => {
      if (!tokenOk(req)) { deny(res, 'unauthorized'); return }
      try { const q = qp(req); const sid = q.id || ''; const mode = q.mode || 'important'; if (!sid) return json(res, 400, { error: 'missing id' }); const all = await surfaceAll(sid); const msgs = mode === 'raw' ? all.map(m => ({ role: m.role, name: m.name || null, text: m.text, long: false })) : compactMessages(all); json(res, 200, { id: sid, mode, messages: msgs }) } catch (e) { json(res, 500, { error: String((e && e.message) || e) }) } } }))
    routes.push(ws.register({ kind: 'exact', path: '/phn/api/send', handler: async (req, res) => {
      if (!tokenOk(req)) { deny(res, 'unauthorized'); return }
      const body = await readBody(req); const sid = String(body.id || ''); const text = String(body.message || '').trim(); if (!sid) return json(res, 400, { error: 'missing id' }); if (!text) return json(res, 400, { error: 'empty message' }); try { let agent = agentsSvc.get(sid); if (!agent && agentsSvc.resume && typeof agentsSvc.resume === 'function') { try { const h = await agentsSvc.resume({ resumeSessionId: sid }); agent = (h && h.agent) || null } catch (_e) {} }; if (!agent) return json(res, 404, { error: 'session not live', id: sid }); const message = { id: uid(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }; if (agent.followup) await agent.followup(message); else if (agent.send) await agent.send(message, 'next-turn', true); else return json(res, 501, { error: 'no followup available' }); json(res, 200, { ok: true, id: sid, queued: true }) } catch (e) { json(res, 500, { error: String((e && e.message) || e) }) } } }))
    const uid = () => { try { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('') } catch (_e) { return 'phn-' + Date.now() + '-' + Math.floor(Math.random() * 1e9) } }
    routes.push(ws.register({ kind: 'exact', path: '/phn/events', handler: (req, res) => {
      if (!tokenOk(req)) { deny(res, 'unauthorized'); return }
      // Plan R22/R20: cap concurrent clients and keep the stream alive with
      // an SSE comment heartbeat so Cloudflare's ~100s idle timeout cannot
      // silently kill the phone's "live" connection.
      if (sseClients.size >= 32) { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end('too many clients'); return }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write('retry: 2000\n\n')
      sseClients.add(res)
      const hb = ctx.interval(() => { try { res.write(': ping\n\n') } catch (_e) {} }, 30000)
      req.on('close', () => { sseClients.delete(res); try { hb() } catch (_e) {} })
    } }))
    routes.push(ws.register({ kind: 'exact', path: '/phn/api/status', handler: (req, res) => {
      if (!tokenOk(req)) { deny(res, 'unauthorized'); return }
      json(res, 200, { tunnel: '', upstream: UPSTREAM, time: Date.now() })
    } }))

    const CSS = 'body{margin:0;background:#0e1117;color:#e6e6e6;font-family:system-ui,-apple-system,sans-serif;}header{position:sticky;top:0;background:#161b26;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #262c3a;}h1{font-size:15px;margin:0;}ul{list-style:none;margin:0;padding:8px 12px;}li{padding:12px 10px;border-bottom:1px solid #212836;}.wsec{font-size:12px;color:#7c8698;padding:14px 16px 4px;font-weight:600;}.tt{font-size:14px;}.sub{font-size:11px;color:#7c8698;margin-top:3px;}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#555;margin-right:6px;}.dot.g{background:#6bd968}.msg{padding:12px 16px;font-size:14px;line-height:1.55;}.rm{font-size:11px;letter-spacing:.5px;margin-bottom:5px;}.u{color:#7db3ff}.a{color:#d8d8d8}.t{color:#c5a46a;font-size:13px}.note{color:#5b6475}li:active{background:#161b26}.back{color:#9aa7bd;padding:10px 14px;font-size:14px;cursor:pointer;}.empty{color:#5b6475;padding:40px 16px;text-align:center;}.err{color:#e06c75;padding:12px 16px;}.sendrow{position:sticky;bottom:0;background:#0e1117;padding:10px 12px;border-top:1px solid #222a3a;}textarea{width:100%;box-sizing:border-box;background:#0e1117;color:#e6e6e6;border:1px solid #2a3242;border-radius:10px;padding:10px;font-size:15px;min-height:52px;}button{width:100%;margin-top:8px;padding:12px;background:#2f6feb;color:#fff;border:none;border-radius:10px;font-size:15px;}button:disabled{opacity:.5}.toolbar{padding:8px 14px;display:flex;gap:8px;border-bottom:1px solid #1a2130;font-size:12px;}.tb{color:#9aa7bd;cursor:pointer;padding:3px 11px;border:1px solid #2a3242;border-radius:999px;user-select:none;}.tb.on{color:#fff;border-color:#2f6feb;background:#1d2735}.expand{color:#2f6feb;font-size:12px;margin-top:6px;cursor:pointer;}.hiddennote{font-size:11px;color:#475060;padding:8px 16px;}'

    routes.push(ws.register({
      kind: 'exact',
      path: '/phn',
      handler: (req, res) => {
        const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>DSH 手机端</title><style>${CSS}</style></head><body>
<header><h1>DSH 手机端</h1><span class="sub" id="live"></span></header>
<div class="toolbar"><span class="tb on" id="tb-important" onclick="setMode('important')">重要内容</span><span class="tb" id="tb-raw" onclick="setMode('raw')">完整</span></div>
<div id="view"><div class="empty">加载中…</div></div>
<script>
let mode='important', sessions=[], workspaces=[], current=null
const $=id=>document.getElementById(id)
const esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
const fmt=t=>{if(!t)return'';const d=new Date(t);const now=new Date();const s=(now-d)/1000;if(s<60)return'刚刚';if(s<3600)return Math.floor(s/60)+' 分钟前';if(s<86400)return Math.floor(s/3600)+' 小时前';return Math.floor(s/86400)+' 天前'}
function setMode(m){mode=m;$('tb-important').className='tb'+(m==='important'?' on':'');$('tb-raw').className='tb'+(m==='raw'?' on':'');if(current)loadSurface(current)}
async function loadList(){try{const r=await fetch('/phn/api/sessions');const d=await r.json();sessions=d.sessions||[];workspaces=d.workspaces||[];renderList()}catch(e){$('view').innerHTML='<div class="err">加载失败: '+esc(e.message)+'</div>'}}
function renderList(){const wm={};workspaces.forEach(w=>w.sessionIds.forEach(id=>wm[id]=w.title));const html=sessions.map(s=>'<li onclick="openS(\''+s.id+'\')"><span class="dot'+(s.live?' g':'')+'"></span><div class="tt">'+esc(s.title||'(无标题)')+'</div><div class="sub">'+(wm[s.id]?esc(wm[s.id])+' · ':'')+fmt(s.time)+'</div></li>').join('');$('view').innerHTML=html||'<div class="empty">暂无会话</div>'}
async function openS(id){current=id;history.replaceState(null,'','#s='+id);loadSurface(id)}
async function loadSurface(id){try{const r=await fetch('/phn/api/surface?id='+encodeURIComponent(id)+'&mode='+mode);const d=await r.json();renderSurface(d)}catch(e){$('view').innerHTML='<div class="err">'+esc(e.message)+'</div>'}}
function renderSurface(d){const msgs=d.messages||[];let html='<div class="back" onclick="back()">‹ 返回</div>';for(const m of msgs){if(m.hidden){html+='<div class="hiddennote">…（已折叠系统注入内容）</div>';continue}if(m.role==='tool'){html+='<div class="msg t">'+esc(m.text||m.name)+'</div>';continue}html+='<div class="msg"><div class="rm '+(m.role==='user'?'u':'a')+'">'+(m.role==='user'?'你':'DSH')+'</div>'+esc(m.text);if(m.long)html+='<div class="expand" onclick="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\'">展开全文</div><div style="display:none">'+esc(m.full)+'</div>';html+='</div>'}
html+='<div class="sendrow"><textarea id="inp" placeholder="发消息…"></textarea><button onclick="send()">发送</button></div>';$('view').innerHTML=html}
function back(){current=null;history.replaceState(null,'','#list');loadList()}
async function send(){const t=$('inp').value.trim();if(!t||!current)return;try{const r=await fetch('/phn/api/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:current,message:t})});const d=await r.json();if(d.ok){$('inp').value='';loadSurface(current)}else{alert(d.error||'发送失败')}}catch(e){alert('发送失败: '+e.message)}}
function onHash(){const m=location.hash.match(/^#s=(.+)$/);if(m&&m[1]){current=decodeURIComponent(m[1]);loadSurface(current)}else{current=null;loadList()}}
window.addEventListener('hashchange',onHash)
const es=new EventSource('/phn/events');es.addEventListener('agent-status',e=>{try{const d=JSON.parse(e.data);if(current===d.sessionId)loadSurface(current);const dot=document.querySelector('.dot.g');if(dot)dot.className='dot g'}catch(_e){}})
onHash();setInterval(()=>{if(!current)loadList()},30000)
</script></body></html>`
        plain(res, 200, html)
      }
    }))

    // ───────────────────────── lifecycle + HTTP control ─────────────────────────
    // NOTE: the original dynamic plugin used `harness.handle('phone/*')`, which
    // only exists in the dynamic-plugin Builtin environment. As a persisted
    // package plugin we expose the same operations as HTTP routes instead —
    // reachable from the desktop main process and the phone alike.
    ctx.effect(() => () => { clearTick(); stopAll(); for (const r of routes) r() })

    routes.push(ws.register({ kind: 'exact', path: '/phn/api/tunnel/status', handler: (req, res) => {
      if (!tokenOk(req)) { deny(res, 'unauthorized'); return }
      json(res, 200, { ...status(), upstream: UPSTREAM })
    } }))
    routes.push(ws.register({ kind: 'exact', path: '/phn/api/tunnel/start', handler: async (req, res) => {
      if (!tokenOk(req)) { deny(res, 'unauthorized'); return }
      try {
        if (state.phase === 'active' || state.phase === 'starting' || state.phase === 'installing') return json(res, 200, status())
        // Plan R29: never open a public tunnel unless OUR gate is up.
        if (!(await gateHealthy())) return json(res, 200, { ...status(), phase: 'idle', message: 'PIN 网关未就绪，拒绝建立隧道（请确认桌面端已运行）', upstream: UPSTREAM })
        if (await foundCloudflared()) void startTunnel()
        else startInstalling()
        await waitActive(16000)
        json(res, 200, status())
      } catch (e) { json(res, 500, { error: String((e && e.message) || e) }) }
    } }))
    routes.push(ws.register({ kind: 'exact', path: '/phn/api/tunnel/stop', handler: (req, res) => {
      if (!tokenOk(req)) { deny(res, 'unauthorized'); return }
      stopAll(); state.phase = 'idle'; state.url = null; state.message = '隧道已关闭'; clearTick()
      json(res, 200, status())
    } }))
  },
}
