/* @dshd/desktop-chrome — desktop-only session/composer actions.
 * Linked into ~/.dsh-desktop only. The :3080 web instance never loads this.
 */
/* Bridge for dsh-better-sidebar's editor chunk: the desktop shell exposes
 * __ModuleLoader__.load(), which registers plugin bundles but does not expose
 * the import() method required by better-sidebar's lazy chunks. The plugin
 * factory receives the shell's resolved external require, so the adapter is
 * completed inside the factory below. */
try {
  if (typeof window !== 'undefined' && window.__ModuleLoader__) {
    if (!window.__DSH_MODULES__) window.__DSH_MODULES__ = window.__ModuleLoader__
    if (!window.__dshSidebarModuleSystem__) window.__dshSidebarModuleSystem__ = window.__ModuleLoader__
  }
} catch (_) { /* never block boot */ }
window.__ModuleLoader__.load({
  id: '@dshd/desktop-chrome',
  factory: (require) => {
    var module = { exports: {} }
    // __ModuleLoader__ is a registration API, not the module system consumed
    // by dsh-better-sidebar's lazy editor/terminal chunks. Reuse an existing
    // system when the shell provides one; otherwise adapt this factory's
    // external resolver to the small async import() surface the chunks need.
    try {
      var globalScope = typeof globalThis !== 'undefined' ? globalThis : window
      var moduleSystem = globalScope.__DSH_MODULES__
      if (!moduleSystem || typeof moduleSystem.import !== 'function') moduleSystem = globalScope.__dshSidebarModuleSystem__
      if (!moduleSystem || typeof moduleSystem.import !== 'function') {
        moduleSystem = {
          import: (specifier) => Promise.resolve(require(specifier)),
        }
      }
      globalScope.__DSH_MODULES__ = moduleSystem
      globalScope.__dshSidebarModuleSystem__ = moduleSystem
    } catch (_) { /* never block desktop chrome boot */ }
    var React = require('react')
    var h = React.createElement
    var PIN_KEY = 'dshd.desktop-chrome.pins'

    function loadPins() {
      try {
        var raw = localStorage.getItem(PIN_KEY)
        var parsed = raw ? JSON.parse(raw) : []
        return Array.isArray(parsed) ? parsed.filter(function (id) { return typeof id === 'string' }) : []
      } catch {
        return []
      }
    }

    function savePins(ids) {
      try { localStorage.setItem(PIN_KEY, JSON.stringify(ids)) } catch { /* ignore */ }
    }

    function isPinned(id) {
      return loadPins().indexOf(id) !== -1
    }

    function togglePin(id) {
      var pins = loadPins().slice()
      var i = pins.indexOf(id)
      if (i === -1) pins.unshift(id)
      else pins.splice(i, 1)
      savePins(pins)
      return pins.indexOf(id) !== -1
    }

    function encodeSessionUri(sessionId) {
      var json = JSON.stringify(sessionId)
      var bytes = new TextEncoder().encode(json)
      var bin = ''
      for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      var b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
      return 'dsh-session:' + b64
    }

    function formatSessionMention(id, label) {
      var text = String(label || id).replace(/[\\\]]/g, function (m) { return '\\' + m })
      return '@[' + text + '](' + encodeSessionUri(id) + ')'
    }

    function appendDraft(inputActions, useInput, chunk) {
      if (!inputActions || typeof inputActions.setDraft !== 'function') return
      var draft = ''
      try { draft = useInput(function (s) { return (s && s.draft) || '' }) } catch { draft = '' }
      var next = draft
      if (next && !/\s$/.test(next)) next += ' '
      next += chunk
      inputActions.setDraft(next)
    }

    function copyText(text) {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text)
      }
      return Promise.reject(new Error('clipboard unavailable'))
    }

    function filePath(file) {
      if (file && typeof file.path === 'string' && file.path) return file.path
      if (file && typeof file.webkitRelativePath === 'string' && file.webkitRelativePath) {
        var rel = file.webkitRelativePath
        var slash = rel.indexOf('/')
        return slash === -1 ? rel : rel.slice(0, slash)
      }
      return file && file.name ? file.name : ''
    }

    function dirname(p) {
      if (!p) return ''
      var i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
      return i <= 0 ? p : p.slice(0, i)
    }

    var BTN = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: 28,
      minWidth: 28,
      padding: '0 8px',
      border: 'none',
      borderRadius: 6,
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      fontSize: 13,
      lineHeight: 1,
      opacity: 0.85,
    }
    var MENU = {
      position: 'absolute',
      zIndex: 40,
      minWidth: 196,
      maxHeight: 280,
      overflowY: 'auto',
      marginTop: 4,
      padding: '4px 0',
      borderRadius: 8,
      border: '1px solid rgba(148,163,184,0.28)',
      background: 'var(--background, Canvas)',
      color: 'var(--foreground, inherit)',
      boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
    }
    var ITEM = {
      display: 'block',
      width: '100%',
      textAlign: 'left',
      border: 'none',
      background: 'transparent',
      color: 'inherit',
      padding: '7px 12px',
      fontSize: 13,
      cursor: 'pointer',
    }

    function MenuItem(props) {
      return h('button', {
        type: 'button',
        style: ITEM,
        onClick: props.onClick,
      }, props.label)
    }

    function SessionDots(props) {
      var sessionId = props.sessionId
      var useSessions = props.useSessions
      var [open, setOpen] = React.useState(false)
      var [pinned, setPinned] = React.useState(function () { return isPinned(sessionId) })
      var [toast, setToast] = React.useState('')
      React.useEffect(function () { setPinned(isPinned(sessionId)) }, [sessionId])

      function cwdOf() {
        try {
          var row = useSessions(function (s) { return s && s.byId && sessionId ? s.byId[sessionId] : null })
          return (row && row.cwd) || ''
        } catch { return '' }
      }

      function onCopyDir() {
        var cwd = cwdOf()
        setOpen(false)
        if (!cwd) { setToast('当前会话没有工作目录'); return }
        copyText(cwd).then(function () { setToast('已复制目录') }).catch(function () { setToast(cwd) })
      }

      function onPin() {
        setPinned(togglePin(sessionId))
        setOpen(false)
      }

      return h('div', { style: { position: 'relative', display: 'inline-flex', alignItems: 'center' } },
        h('button', {
          type: 'button',
          style: BTN,
          title: '会话操作（仅桌面端）',
          'aria-label': '会话操作',
          onClick: function (e) { e.stopPropagation(); setOpen(!open); setToast('') },
        }, '⋯'),
        open && h('div', { style: Object.assign({}, MENU, { right: 0 }) },
          h(MenuItem, { label: '复制目录', onClick: onCopyDir }),
          h(MenuItem, { label: pinned ? '取消置顶' : '置顶', onClick: onPin }),
        ),
        toast ? h('span', { style: { marginLeft: 6, fontSize: 11, opacity: 0.65 } }, toast) : null,
      )
    }

    function PlusMenu(props) {
      var inputActions = props.inputActions
      var useInput = props.useInput
      var useSessions = props.useSessions
      var sessionId = props.sessionId
      var [open, setOpen] = React.useState(false)
      var [sub, setSub] = React.useState(null)
      var fileRef = React.useRef(null)
      var folderRef = React.useRef(null)

      function insertPaths(files, folder) {
        var paths = []
        for (var i = 0; i < files.length; i++) {
          var p = filePath(files[i])
          if (p && paths.indexOf(p) === -1) paths.push(p)
        }
        if (folder && paths.length) {
          var dir = dirname(paths[0])
          if (dir) paths = [dir]
        }
        if (!paths.length) { setOpen(false); return }
        appendDraft(inputActions, useInput, paths.map(function (p) { return '`' + p + '`' }).join(' '))
        setOpen(false)
        setSub(null)
      }

      function sessions() {
        try {
          var state = useSessions(function (s) { return s })
          if (!state || !state.ids) return []
          var out = []
          for (var i = 0; i < state.ids.length && out.length < 16; i++) {
            var id = state.ids[i]
            if (id === sessionId) continue
            var row = state.byId[id]
            out.push({ id: id, label: (row && (row.displayTitle || row.title)) || id })
          }
          return out
        } catch { return [] }
      }

      function mention(id, label) {
        appendDraft(inputActions, useInput, formatSessionMention(id, label))
        setOpen(false)
        setSub(null)
      }

      return h('div', { style: { position: 'relative', display: 'inline-flex' } },
        h('button', {
          type: 'button',
          style: BTN,
          title: '添加文件 / 文件夹 / 引用会话（仅桌面端）',
          'aria-label': '添加',
          onClick: function (e) { e.stopPropagation(); setOpen(!open); setSub(null) },
        }, '添加'),
        h('input', {
          ref: fileRef,
          type: 'file',
          multiple: true,
          style: { display: 'none' },
          onChange: function (e) {
            insertPaths(e.target.files || [], false)
            e.target.value = ''
          },
        }),
        h('input', {
          ref: folderRef,
          type: 'file',
          multiple: true,
          webkitdirectory: '',
          directory: '',
          style: { display: 'none' },
          onChange: function (e) {
            insertPaths(e.target.files || [], true)
            e.target.value = ''
          },
        }),
        open && h('div', { style: Object.assign({}, MENU, { left: 0, bottom: '100%', marginTop: 0, marginBottom: 4 }) },
          h(MenuItem, { label: '添加文件', onClick: function () { if (fileRef.current) fileRef.current.click() } }),
          h(MenuItem, { label: '添加文件夹', onClick: function () { if (folderRef.current) folderRef.current.click() } }),
          h(MenuItem, { label: '@ 之前的会话', onClick: function () { setSub(sub === 'sessions' ? null : 'sessions') } }),
          sub === 'sessions' && sessions().map(function (row) {
            return h(MenuItem, {
              key: row.id,
              label: '  ' + row.label,
              onClick: function () { mention(row.id, row.label) },
            })
          }),
          sub === 'sessions' && sessions().length === 0 && h('div', { style: Object.assign({}, ITEM, { opacity: 0.5, cursor: 'default' }) }, '  没有其他会话'),
        ),
      )
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.session.header.actions', function () {
        return ctx.slots.register(
          { name: 'conversation.session.header.actions', id: 'desktop-chrome-dots', order: 80, label: function () { return '会话操作' } },
          function (props) {
            return h(SessionDots, { sessionId: props.sessionId, useSessions: props.useSessions })
          },
        )
      })
      ctx.slots.inject('conversation.input.left', function () {
        return ctx.slots.register(
          { name: 'conversation.input.left', id: 'desktop-chrome-plus', order: -20, label: function () { return '添加' } },
          function (props) {
            return h(PlusMenu, {
              inputActions: props.inputActions,
              useInput: props.useInput,
              useSessions: props.useSessions,
              sessionId: props.sessionId,
            })
          },
        )
      })
    }

    module.exports = { name: 'desktop-chrome', inject: ['slots'], apply: apply }
    return module.exports
  },
})
