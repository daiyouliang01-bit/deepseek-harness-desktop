/* @dshd/dsh-installed client — Settings → Plugins → 已安装 */
window.__ModuleLoader__.load({
  id: '@dshd/dsh-installed',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement
    var useCallback = React.useCallback
    var useEffect = React.useEffect
    var useMemo = React.useMemo
    var useState = React.useState

    var NS = 'dsh-installed'
    var zh = {
      tab: '已安装',
      title: '已安装',
      subtitle: '只列出本机还在用的插件和技能。默认更新不会把已经去掉的功能加回来。',
      plugins: '插件',
      skills: '技能',
      search: '搜索名称或简述…',
      empty: '还没有自己安装的插件或技能',
      emptyFilter: '没有匹配的条目',
      loading: '正在读取已安装清单…',
      loadFailed: '清单读取失败',
      retry: '重试',
      check: '检查更新',
      checking: '检查中…',
      applyLocal: '更新本机功能',
      applyComplete: '完整更新',
      applying: '更新中…',
      local: '本地',
      upToDate: '已是最新',
      available: '有更新',
      error: '未检查到',
      unchecked: '未检查',
      version: '版本',
      spec: '安装规格',
      source: '来源',
      pickTitle: '选择要更新的插件',
      pickHint: '默认勾选本机还在用的功能。去掉的功能不会勾选，也不会被默认更新。',
      removed: '本机已去掉',
      confirm: '开始更新',
      cancel: '取消',
      restartHint: '更新完成后请重启 DSH / 桌面壳，再刷新页面。',
    }
    var en = {
      tab: 'Installed',
      title: 'Installed',
      subtitle: 'Plugins and skills still enabled on this machine. Default updates never restore removed features.',
      plugins: 'Plugins',
      skills: 'Skills',
      search: 'Search name or summary…',
      empty: 'No user-installed plugins or skills yet',
      emptyFilter: 'No matching items',
      loading: 'Loading installed inventory…',
      loadFailed: 'Could not load the inventory',
      retry: 'Retry',
      check: 'Check for updates',
      checking: 'Checking…',
      applyLocal: 'Update local features',
      applyComplete: 'Full update',
      applying: 'Updating…',
      local: 'Local',
      upToDate: 'Up to date',
      available: 'Update available',
      error: 'Not checked',
      unchecked: 'Not checked',
      version: 'Version',
      spec: 'Install spec',
      source: 'Source',
      pickTitle: 'Choose plugins to update',
      pickHint: 'Enabled local features are selected. Removed features stay unchecked.',
      removed: 'Removed locally',
      confirm: 'Update selected',
      cancel: 'Cancel',
      restartHint: 'Restart DSH / the desktop shell, then refresh.',
    }

    var CSS = [
      '.din-root{color:var(--dsw-alias-label-primary,#202124);display:flex;flex-direction:column;gap:14px;min-width:0}',
      '.din-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}',
      '.din-brand{min-width:0;flex:1 1 260px}',
      '.din-brand h3{font-size:20px;line-height:1.25;margin:0 0 4px}',
      '.din-brand p{color:var(--dsw-alias-label-secondary,#667085);font-size:13px;line-height:1.5;margin:0}',
      '.din-meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.din-pill{background:var(--dsw-alias-bg-layer-2,#f2f4f7);border-radius:999px;color:var(--dsw-alias-label-secondary,#667085);font-size:12px;padding:5px 9px}',
      '.din-action{appearance:none;background:#4f46e5;border:1px solid #4f46e5;border-radius:9px;color:#fff;cursor:pointer;font:inherit;font-size:13px;font-weight:650;min-height:38px;padding:7px 14px}',
      '.din-action.din-ghost{background:transparent;border-color:var(--dsw-alias-border-normal,#667085);color:var(--dsw-alias-label-primary,#e8eaed)}',
      '.din-action.din-small{min-height:30px;padding:4px 10px;font-size:12px}',
      '.din-action:disabled{cursor:not-allowed;opacity:.55}',
      '.din-search{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-normal,#d0d5dd);border-radius:10px;color:inherit;font:inherit;min-height:42px;padding:0 13px;width:100%}',
      '.din-error{background:var(--dsw-alias-state-danger-secondary,#fff0f0);border:1px solid var(--dsw-alias-state-danger-border,#eaa);border-radius:10px;color:var(--dsw-alias-state-danger-primary,#a12626);font-size:13px;padding:10px 12px}',
      '.din-section h4{font-size:13px;font-weight:700;margin:8px 0}',
      '.din-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))}',
      '.din-card{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-subtle,#e4e7ec);border-radius:12px;display:flex;flex-direction:column;gap:8px;min-width:0;padding:13px}',
      '.din-name{font-size:14px;font-weight:700;line-height:1.35;overflow-wrap:anywhere}',
      '.din-desc{color:var(--dsw-alias-label-secondary,#586174);display:-webkit-box;font-size:13px;line-height:1.5;min-height:39px;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2}',
      '.din-note{background:var(--dsw-alias-state-warn-secondary,#fff7e6);border-radius:8px;color:#8a5a00;font-size:12px;line-height:1.5;padding:6px 8px}',
      '.din-foot{align-items:center;display:flex;gap:8px;flex-wrap:wrap}',
      '.din-badge{border-radius:999px;font-size:11px;padding:4px 8px;background:var(--dsw-alias-bg-layer-2,#f2f4f7);color:var(--dsw-alias-label-secondary,#667085)}',
      '.din-badge[data-status=available]{background:var(--dsw-alias-state-warn-secondary,#fff7e6);color:#8a5a00}',
      '.din-badge[data-status=up-to-date]{background:#ecfdf3;color:#067647}',
      '.din-badge[data-status=error]{background:var(--dsw-alias-state-danger-secondary,#fff0f0);color:#a12626}',
      '.din-state{align-items:center;color:var(--dsw-alias-label-secondary,#667085);display:flex;font-size:13px;gap:8px;justify-content:center;min-height:120px}',
      '.din-spin{animation:din-spin .8s linear infinite;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;height:15px;width:15px}',
      '@keyframes din-spin{to{transform:rotate(360deg)}}',
      '.din-mask{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:80;display:flex;align-items:center;justify-content:center;padding:20px}',
      '.din-dialog{background:var(--dsw-alias-bg-layer-1,#16181d);color:var(--dsw-alias-label-primary,#e8eaed);border:1px solid var(--dsw-alias-border-subtle,#2a2e37);border-radius:14px;max-width:560px;width:100%;max-height:min(80vh,720px);display:flex;flex-direction:column;padding:16px;gap:12px}',
      '.din-dialog h3{margin:0;font-size:16px}',
      '.din-pick{overflow:auto;display:flex;flex-direction:column;gap:8px}',
      '.din-pick label{display:flex;gap:10px;align-items:flex-start;padding:8px;border:1px solid var(--dsw-alias-border-subtle,#2a2e37);border-radius:10px}',
      '.din-pick strong{display:block;font-size:13px}',
      '.din-pick span{display:block;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa0a8);line-height:1.45}',
    ].join('')

    function mountStyles() {
      if (typeof document === 'undefined') return function () {}
      var style = document.getElementById('dsh-installed-style')
      if (!style) {
        style = document.createElement('style')
        style.id = 'dsh-installed-style'
        style.textContent = CSS
        document.head.appendChild(style)
      }
      return function () {
        if (style && style.parentNode) style.parentNode.removeChild(style)
      }
    }

    function responseJson(response) {
      return response.json().catch(function () { return {} }).then(function (body) {
        return { status: response.status, body: body }
      })
    }

    function badgeLabel(copy, update) {
      if (!update || update.status === 'unchecked') return copy.unchecked
      if (update.status === 'local') return copy.local
      if (update.status === 'up-to-date') return copy.upToDate
      if (update.status === 'available') {
        return copy.available + (update.latest ? ' v' + update.latest : '')
      }
      return copy.error
    }

    function filterItems(items, needle) {
      if (!needle) return items
      return items.filter(function (item) {
        return (item.name + ' ' + (item.titleZh || '') + ' ' + (item.summaryZh || '') + ' ' + (item.description || '')).toLowerCase().includes(needle)
      })
    }

    function Card(item, copy, onApplyOne) {
      var update = item.update || { status: 'unchecked' }
      var title = item.titleZh || item.name
      var desc = item.summaryZh || item.description || '—'
      return h('article', { className: 'din-card', key: item.id },
        h('div', { className: 'din-name' }, title),
        h('div', { className: 'din-desc' }, desc),
        update.status === 'available' && update.noteZh
          ? h('div', { className: 'din-note' }, '📦 ' + update.noteZh)
          : null,
        h('div', { className: 'din-foot' },
          h('span', { className: 'din-badge' }, item.kind === 'skill' ? copy.skills : copy.plugins),
          item.version ? h('span', { className: 'din-badge' }, 'v' + item.version) : null,
          h('span', { className: 'din-badge', 'data-status': update.status }, badgeLabel(copy, update)),
          update.status === 'available' && onApplyOne
            ? h('button', {
              className: 'din-action din-small',
              type: 'button',
              onClick: function () { onApplyOne(item) },
            }, copy.applyLocal)
            : null))
    }

    function InstalledTab(props) {
      var locale = props.locale
      var localeSnapshot = React.useSyncExternalStore(
        function (listener) { return locale.subscribe(listener) },
        function () { return locale.getSnapshot() },
      )
      var lang = String(localeSnapshot.active).toLowerCase().startsWith('zh') ? 'zh' : 'en'
      var copy = lang === 'zh' ? zh : en
      var inventory = useState(null)
      var setInventory = inventory[1]
      var data = inventory[0]
      var errorState = useState(null)
      var error = errorState[0]
      var setError = errorState[1]
      var loadingState = useState(true)
      var loading = loadingState[0]
      var setLoading = loadingState[1]
      var checkingState = useState(false)
      var checking = checkingState[0]
      var setChecking = checkingState[1]
      var queryState = useState('')
      var query = queryState[0]
      var setQuery = queryState[1]
      var applyingState = useState(false)
      var applying = applyingState[0]
      var setApplying = applyingState[1]
      var pickerState = useState(false)
      var picker = pickerState[0]
      var setPicker = pickerState[1]
      var pickedState = useState({})
      var picked = pickedState[0]
      var setPicked = pickedState[1]
      var noticeState = useState(null)
      var notice = noticeState[0]
      var setNotice = noticeState[1]

      var load = useCallback(function () {
        setLoading(true)
        setError(null)
        return fetch('/dsh-installed/list', { cache: 'no-store' })
          .then(responseJson)
          .then(function (result) {
            if (result.status !== 200) throw new Error(result.body.error || ('HTTP ' + result.status))
            setInventory({
              plugins: result.body.plugins || [],
              skills: result.body.skills || [],
              candidates: result.body.candidates || result.body.plugins || [],
            })
          })
          .catch(function (err) {
            setError(String(err && err.message ? err.message : err))
          })
          .finally(function () { setLoading(false) })
      }, [])

      var check = useCallback(function () {
        setChecking(true)
        setError(null)
        return fetch('/dsh-installed/check-updates', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
          .then(responseJson)
          .then(function (result) {
            if (result.status !== 200) throw new Error(result.body.error || ('HTTP ' + result.status))
            setInventory({
              plugins: result.body.plugins || [],
              skills: result.body.skills || [],
              candidates: result.body.candidates || result.body.plugins || [],
            })
          })
          .catch(function (err) {
            setError(String(err && err.message ? err.message : err))
          })
          .finally(function () { setChecking(false) })
      }, [])

      var apply = useCallback(function (mode, ids) {
        setApplying(true)
        setError(null)
        setNotice(null)
        return fetch('/dsh-installed/apply-updates', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: mode, ids: ids || [] }),
        })
          .then(responseJson)
          .then(function (result) {
            if (result.status !== 200) throw new Error(result.body.error || result.body.message || ('HTTP ' + result.status))
            setInventory({
              plugins: result.body.plugins || (data ? data.plugins : []),
              skills: result.body.skills || (data ? data.skills : []),
              candidates: result.body.candidates || result.body.plugins || [],
            })
            setNotice((result.body.message || copy.applyLocal) + '。' + copy.restartHint)
            setPicker(false)
          })
          .catch(function (err) {
            setError(String(err && err.message ? err.message : err))
          })
          .finally(function () { setApplying(false) })
      }, [data, copy.applyLocal, copy.restartHint])

      useEffect(function () {
        load()
      }, [load])

      var needle = query.trim().toLowerCase()
      var plugins = useMemo(function () {
        return filterItems(data ? data.plugins : [], needle)
      }, [data, needle])
      var skills = useMemo(function () {
        return filterItems(data ? data.skills : [], needle)
      }, [data, needle])
      var available = useMemo(function () {
        if (!data) return 0
        return data.plugins.concat(data.skills).filter(function (item) {
          return item.update && item.update.status === 'available'
        }).length
      }, [data])

      var body
      if (loading && data === null) {
        body = h('div', { className: 'din-state' }, h('span', { className: 'din-spin' }), ' ', copy.loading)
      } else if (data === null) {
        body = h('div', { className: 'din-state' },
          copy.loadFailed,
          ' ',
          h('button', { className: 'din-action', type: 'button', onClick: load }, copy.retry))
      } else if (plugins.length === 0 && skills.length === 0) {
        body = h('div', { className: 'din-state' }, needle ? copy.emptyFilter : copy.empty)
      } else {
        body = h(React.Fragment, null,
          plugins.length > 0 && h('section', { className: 'din-section' },
            h('h4', null, copy.plugins + ' (' + plugins.length + ')'),
            h('div', { className: 'din-grid' }, plugins.map(function (item) {
              return Card(item, copy, applying ? null : function (one) { apply('complete', [one.id || one.name]) })
            }))),
          skills.length > 0 && h('section', { className: 'din-section' },
            h('h4', null, copy.skills + ' (' + skills.length + ')'),
            h('div', { className: 'din-grid' }, skills.map(function (item) { return Card(item, copy) }))))
      }

      var candidates = ((data && data.candidates) || []).filter(function (item) {
        return item.update && item.update.status === 'available'
      })

      return h('div', { className: 'din-root' },
        h('div', { className: 'din-head' },
          h('div', { className: 'din-brand' },
            h('h3', null, copy.title),
            h('p', null, copy.subtitle)),
          h('div', { className: 'din-meta' },
            data && h('span', { className: 'din-pill' }, copy.plugins + ' ' + data.plugins.length),
            data && h('span', { className: 'din-pill' }, copy.skills + ' ' + data.skills.length),
            available > 0 && h('span', { className: 'din-pill' }, copy.available + ' ' + available),
            h('button', {
              className: 'din-action',
              type: 'button',
              disabled: checking || applying || data === null,
              onClick: check,
            }, checking ? copy.checking : copy.check),
            h('button', {
              className: 'din-action',
              type: 'button',
              disabled: applying || available === 0,
              onClick: function () { apply('local') },
            }, applying ? copy.applying : copy.applyLocal),
            h('button', {
              className: 'din-action din-ghost',
              type: 'button',
              disabled: applying || candidates.length === 0,
              onClick: function () {
                var next = {}
                candidates.forEach(function (item) {
                  next[item.id || item.name] = item.enabled !== false && !item.removed
                })
                setPicked(next)
                setPicker(true)
              },
            }, copy.applyComplete))),
        h('input', {
          className: 'din-search',
          type: 'search',
          value: query,
          placeholder: copy.search,
          onChange: function (event) { setQuery(event.target.value) },
        }),
        error && h('div', { className: 'din-error' }, error),
        notice && h('div', { className: 'din-pill' }, notice),
        body,
        picker && h('div', { className: 'din-mask', onClick: function () { if (!applying) setPicker(false) } },
          h('div', { className: 'din-dialog', onClick: function (event) { event.stopPropagation() } },
            h('h3', null, copy.pickTitle),
            h('p', { className: 'din-desc' }, copy.pickHint),
            h('div', { className: 'din-pick' },
              candidates.map(function (item) {
                var id = item.id || item.name
                return h('label', { key: id },
                  h('input', {
                    type: 'checkbox',
                    checked: !!picked[id],
                    onChange: function (event) {
                      setPicked(Object.assign({}, picked, { [id]: event.target.checked }))
                    },
                  }),
                  h('div', null,
                    h('strong', null, (item.titleZh || item.name) + (item.removed || item.enabled === false ? ' · ' + copy.removed : '')),
                    h('span', null, (item.update && item.update.noteZh) || item.summaryZh || item.description || '')))
              })),
            h('div', { className: 'din-meta' },
              h('button', {
                className: 'din-action',
                type: 'button',
                disabled: applying || !Object.keys(picked).some(function (id) { return picked[id] }),
                onClick: function () {
                  apply('complete', Object.keys(picked).filter(function (id) { return picked[id] }))
                },
              }, applying ? copy.applying : copy.confirm),
              h('button', {
                className: 'din-action din-ghost',
                type: 'button',
                disabled: applying,
                onClick: function () { setPicker(false) },
              }, copy.cancel)))))
    }

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      }, 'dsh-installed: dictionaries')
      ctx.effect(mountStyles, 'dsh-installed: styles')
      var t = ctx.locale.bind(NS)
      ctx.slots.inject('settings.plugins.tab', function () {
        return ctx.slots.register({
          name: 'settings.plugins.tab',
          id: 'installed',
          order: 5,
          label: function () { return t('tab') },
          locale: NS,
        }, function () {
          return h(InstalledTab, { locale: ctx.locale })
        })
      })
    }

    module.exports = {
      name: 'dsh-installed/client',
      inject: ['slots', 'locale'],
      apply: apply,
    }
    return module.exports
  },
})
