/* Phone console — kept as a real file so quotes cannot be eaten by a host template literal. */
let mode = 'important'
let sessions = []
let workspaces = []
let current = null
let didAutoOpen = false

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[c]))

const fmt = (t) => {
  if (!t) return ''
  const d = new Date(t)
  const now = new Date()
  const s = (now - d) / 1000
  if (s < 60) return '刚刚'
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
  return Math.floor(s / 86400) + ' 天前'
}

function setMode(m) {
  mode = m
  $('tb-important').className = 'tb' + (m === 'important' ? ' on' : '')
  $('tb-raw').className = 'tb' + (m === 'raw' ? ' on' : '')
  if (current) loadSurface(current)
}

async function readJson(r) {
  const d = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error(d.error || ('HTTP ' + r.status))
    err.status = r.status
    throw err
  }
  return d
}

function authHint(status) {
  if (status === 401 || status === 403) {
    return '未通过桌面 PIN 门，请从隧道地址打开（不要直连桌面端口）。'
  }
  return ''
}

async function loadList() {
  try {
    const d = await readJson(await fetch('/phn/api/sessions?live=1'))
    sessions = d.sessions || []
    workspaces = d.workspaces || []
    if (!didAutoOpen && sessions.length === 1) {
      didAutoOpen = true
      openS(sessions[0].id, true)
      return
    }
    renderList()
  } catch (e) {
    const hint = authHint(e.status)
    $('view').innerHTML = '<div class="err">' + esc(hint || ('加载失败: ' + e.message)) + '</div>'
  }
}

function renderList() {
  const wm = {}
  workspaces.forEach((w) => (w.sessionIds || []).forEach((id) => { wm[id] = w.title }))
  const html = sessions.map((s) => (
    '<li data-sid="' + esc(s.id) + '">' +
      '<span class="dot' + (s.live ? ' g' : '') + '"></span>' +
      '<div class="tt">' + esc(s.title || '(无标题)') + '</div>' +
      '<div class="sub">' + (wm[s.id] ? esc(wm[s.id]) + ' · ' : '') + fmt(s.time) + '</div>' +
    '</li>'
  )).join('')
  $('view').innerHTML = html || '<div class="empty">桌面当前没有正在跑的任务</div>'
}

function openS(id, push) {
  current = id
  if (push !== false) history.pushState({ view: 's', id }, '', '#s=' + encodeURIComponent(id))
  loadSurface(id)
}

async function loadSurface(id) {
  try {
    const d = await readJson(await fetch('/phn/api/surface?id=' + encodeURIComponent(id) + '&mode=' + encodeURIComponent(mode)))
    renderSurface(d)
  } catch (e) {
    const hint = authHint(e.status)
    $('view').innerHTML = '<div class="err">' + esc(hint || e.message) + '</div>'
  }
}

function renderSurface(d) {
  const msgs = d.messages || []
  let html = '<div class="back" id="back">‹ 返回</div>'
  for (const m of msgs) {
    if (m.hidden) {
      html += '<div class="hiddennote">…（已折叠系统注入内容）</div>'
      continue
    }
    if (m.role === 'tool') {
      html += '<div class="msg t">' + esc(m.text || m.name) + '</div>'
      continue
    }
    html += '<div class="msg"><div class="rm ' + (m.role === 'user' ? 'u' : 'a') + '">' +
      (m.role === 'user' ? '你' : 'DSH') + '</div>' + esc(m.text)
    if (m.long) {
      html += '<div class="expand">展开全文</div><div class="full" hidden>' + esc(m.full) + '</div>'
    }
    html += '</div>'
  }
  const live = !!(sessions.find((s) => s.id === current) || {}).live
  html += '<div class="sendrow"><textarea id="inp" placeholder="' +
    (live ? '发消息…' : '该会话未在桌面运行，无法续聊') +
    '" enterkeyhint="send"' + (live ? '' : ' disabled') + '></textarea>' +
    '<button id="send" ' + (live ? '' : 'disabled ') + '>' + (live ? '发送' : '无法发送') + '</button></div>'
  $('view').innerHTML = html
}

function back() {
  if (history.state && history.state.view === 's') {
    history.back()
    return
  }
  current = null
  history.replaceState({ view: 'list' }, '', '#list')
  loadList()
}

async function send() {
  const t = $('inp').value.trim()
  if (!t || !current) return
  const btn = $('send')
  if (btn) btn.disabled = true
  try {
    const d = await readJson(await fetch('/phn/api/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: current, message: t }),
    }))
    if (d.ok) {
      $('inp').value = ''
      loadSurface(current)
    } else {
      alert(d.error || '发送失败')
    }
  } catch (e) {
    if (e.status === 404) alert('该会话未在桌面运行，无法续聊')
    else alert(authHint(e.status) || ('发送失败: ' + e.message))
  } finally {
    if (btn && (sessions.find((s) => s.id === current) || {}).live) btn.disabled = false
  }
}

function applyHash(push) {
  const m = location.hash.match(/^#s=(.+)$/)
  if (m && m[1]) openS(decodeURIComponent(m[1]), push)
  else {
    current = null
    loadList()
  }
}

document.addEventListener('click', (ev) => {
  const backEl = ev.target.closest && ev.target.closest('#back')
  if (backEl) { back(); return }
  const sendEl = ev.target.closest && ev.target.closest('#send')
  if (sendEl) { send(); return }
  const expand = ev.target.closest && ev.target.closest('.expand')
  if (expand) {
    expand.hidden = true
    if (expand.nextElementSibling) expand.nextElementSibling.hidden = false
    return
  }
  const li = ev.target.closest && ev.target.closest('li[data-sid]')
  if (li) openS(li.getAttribute('data-sid'), true)
})

$('tb-important').addEventListener('click', () => setMode('important'))
$('tb-raw').addEventListener('click', () => setMode('raw'))
window.addEventListener('popstate', () => applyHash(false))
window.addEventListener('hashchange', () => applyHash(false))

const wfLines = []
function pushWf(line) {
  const box = $('wf')
  if (box) box.hidden = false
  wfLines.push(line)
  while (wfLines.length > 50) wfLines.shift()
  const log = $('wf-log')
  if (log) log.innerHTML = wfLines.map((x) => '<div>' + esc(x) + '</div>').join('')
}

const es = new EventSource('/phn/events')
es.addEventListener('agent-status', (e) => {
  try {
    const d = JSON.parse(e.data)
    const st = $('wf-status')
    if (st) {
      st.textContent = d.status === 'running' ? '运行中' : '已停'
      st.className = 'wf-status' + (d.status === 'running' ? ' run' : '')
    }
    if (current === d.sessionId) loadSurface(current)
  } catch (_e) {}
})
es.addEventListener('workflow', (e) => {
  try {
    const d = JSON.parse(e.data)
    if (d.title) {
      const p = $('wf-phase')
      if (p) p.textContent = d.title
    }
    if (d.message) pushWf(d.message)
    else if (d.kind) pushWf(d.kind + (d.title ? ' · ' + d.title : ''))
  } catch (_e) {}
})

if (!history.state) history.replaceState({ view: location.hash.startsWith('#s=') ? 's' : 'list' }, '', location.hash || '#list')
applyHash(false)
setInterval(() => { if (!current) loadList() }, 30000)
