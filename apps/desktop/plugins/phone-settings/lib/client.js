/* @dshd/phone-settings client bundle — phone access settings page.
 * Registers settings.section "手机" in the official web UI:
 *   - tunnel status / start / stop / copy URL
 *   - access PIN status / set
 * Uses the desktop preload bridge (window.desktop.* — present in the DSH
 * Desktop main window, the same page the injected FAB script already used)
 * with a graceful hint when running under plain `dsh web`.
 */
window.__ModuleLoader__.load({
  id: '@dshd/phone-settings',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useCallback = React.useCallback;

    var PHASE_LABEL = {
      idle: '未启动',
      starting: '启动中…',
      active: '已就绪',
      installing: '安装 cloudflared…',
    };

    // Neutral styles that read well on both light and dark themes.
    var WRAP = { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 };
    var CARD = {
      border: '1px solid rgba(148, 163, 184, 0.25)',
      borderRadius: 12,
      padding: '14px 16px',
      background: 'rgba(148, 163, 184, 0.06)',
    };
    var CARD_TITLE = { fontSize: 14, fontWeight: 700, marginBottom: 4 };
    var MUTED = { fontSize: 12.5, opacity: 0.6, lineHeight: 1.6, marginTop: 4 };
    var ROW = { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 };
    var BTN = {
      padding: '7px 14px',
      borderRadius: 8,
      border: '1px solid rgba(148, 163, 184, 0.35)',
      background: 'rgba(148, 163, 184, 0.1)',
      color: 'inherit',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
    };
    var BTN_DANGER = Object.assign({}, BTN, { color: '#e5484d', borderColor: 'rgba(229, 72, 77, 0.45)' });
    var BTN_DISABLED = { opacity: 0.45, cursor: 'not-allowed' };
    var INPUT = {
      flex: 1,
      padding: '8px 10px',
      borderRadius: 8,
      border: '1px solid rgba(148, 163, 184, 0.3)',
      background: 'rgba(0, 0, 0, 0.12)',
      color: 'inherit',
      fontSize: 13,
    };
    var URLBOX = {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      borderRadius: 8,
      background: 'rgba(0, 0, 0, 0.12)',
      marginTop: 8,
    };
    var CODE = { flex: 1, fontSize: 12.5, wordBreak: 'break-all', opacity: 0.9 };

    function bridge() {
      return typeof window !== 'undefined' && window.desktop ? window.desktop : null;
    }

    function StatusPill({ phase }) {
      var active = phase === 'active';
      return h(
        'span',
        {
          style: {
            fontWeight: 700,
            fontSize: 13,
            color: active ? '#30a46c' : '#f5a623',
          },
        },
        PHASE_LABEL[phase] || String(phase || '…'),
      );
    }

    function TunnelCard() {
      var d = bridge();
      var [status, setStatus] = useState(null);
      var [error, setError] = useState(null);
      var [busy, setBusy] = useState(false);
      var [copied, setCopied] = useState(false);

      var refresh = useCallback(function () {
        var api = bridge();
        if (!api) return;
        api
          .phoneStatus()
          .then(function (res) {
            if (res && res.ok && res.value) {
              setStatus(res.value);
              setError(null);
            } else {
              setError((res && res.error) || '无法读取隧道状态');
            }
          })
          .catch(function (e) {
            setError(String((e && e.message) || e));
          });
      }, []);

      useEffect(function () {
        refresh();
        var t = setInterval(refresh, 3000);
        return function () {
          clearInterval(t);
        };
      }, [refresh]);

      var start = useCallback(function () {
        var api = bridge();
        if (!api) return;
        setBusy(true);
        api
          .phoneStart()
          .then(function (res) {
            if (res && res.ok && res.value) setStatus(res.value);
            else setError((res && res.error) || '启动失败');
          })
          .catch(function (e) {
            setError(String((e && e.message) || e));
          })
          .finally(function () {
            setBusy(false);
          });
      }, []);

      var stop = useCallback(function () {
        var api = bridge();
        if (!api) return;
        setBusy(true);
        api
          .phoneStop()
          .then(function (res) {
            if (res && res.ok && res.value) setStatus(res.value);
            else setError((res && res.error) || '停止失败');
          })
          .catch(function (e) {
            setError(String((e && e.message) || e));
          })
          .finally(function () {
            setBusy(false);
          });
      }, []);

      var copyUrl = useCallback(function () {
        if (!status || !status.url) return;
        try {
          navigator.clipboard.writeText(status.url).then(
            function () {
              setCopied(true);
              setTimeout(function () {
                setCopied(false);
              }, 1500);
            },
            function () {},
          );
        } catch (e) {
          /* clipboard unavailable */
        }
      }, [status]);

      var active = status && status.phase === 'active';

      return h('div', { style: CARD }, [
        h(
          'div',
          { style: ROW },
          h('div', { style: CARD_TITLE }, '隧道状态'),
          h(StatusPill, { phase: status ? status.phase : null }),
        ),
        error
          ? h('p', { style: { color: '#e5484d', fontSize: 12.5, marginTop: 8 } }, '⚠ ' + error)
          : null,
        active && status.url
          ? h('div', { style: URLBOX }, [
              h('code', { style: CODE }, status.url),
              h(
                'button',
                { style: BTN, onClick: copyUrl },
                copied ? '✓ 已复制' : '复制',
              ),
            ])
          : h('p', { style: MUTED }, '启动隧道后，手机可通过生成的 trycloudflare.com 地址访问。'),
        h('div', { style: ROW }, [
          h(
            'button',
            { style: Object.assign({}, BTN, (busy || active) ? BTN_DISABLED : null), disabled: busy || active, onClick: start },
            busy ? '处理中…' : '启动隧道',
          ),
          h(
            'button',
            { style: Object.assign({}, BTN_DANGER, (busy || !active) ? BTN_DISABLED : null), disabled: busy || !active, onClick: stop },
            '停止',
          ),
        ]),
      ]);
    }

    function PinForm() {
      var d = bridge();
      var [enabled, setEnabled] = useState(false);
      var [pin, setPin] = useState('');
      var [confirm, setConfirm] = useState('');
      var [msg, setMsg] = useState(null);
      var [busy, setBusy] = useState(false);

      var refresh = useCallback(function () {
        var api = bridge();
        if (!api) return;
        api
          .pinStatus()
          .then(function (res) {
            if (res && res.ok && res.value) setEnabled(!!res.value.enabled);
          })
          .catch(function () {});
      }, []);

      useEffect(function () {
        refresh();
      }, [refresh]);

      var save = useCallback(
        function () {
          if (pin.length < 4) {
            setMsg('PIN 至少 4 位');
            return;
          }
          if (pin !== confirm) {
            setMsg('两次输入不一致');
            return;
          }
          var api = bridge();
          if (!api) {
            setMsg('PIN 管理仅在 DSH Desktop 桌面应用内可用');
            return;
          }
          setBusy(true);
          setMsg(null);
          api
            .pinSet(pin)
            .then(function (res) {
              setBusy(false);
              if (res && res.ok) {
                setMsg('已保存');
                setPin('');
                setConfirm('');
                refresh();
              } else {
                setMsg((res && res.error) || '保存失败');
              }
            })
            .catch(function (e) {
              setBusy(false);
              setMsg(String((e && e.message) || e));
            });
        },
        [pin, confirm, refresh],
      );

      return h('div', null, [
        h(
          'div',
          { style: ROW },
          h(
            'span',
            { style: { fontSize: 13, color: enabled ? '#30a46c' : '#f5a623', fontWeight: 600 } },
            enabled ? '✅ 已设置' : '⚠ 未设置（手机无法访问）',
          ),
        ),
        h(
          'div',
          { style: ROW },
          h('input', {
            type: 'password',
            placeholder: '新 PIN（至少 4 位）',
            value: pin,
            onChange: function (e) {
              setPin(e.target.value);
            },
            style: INPUT,
          }),
          h('input', {
            type: 'password',
            placeholder: '确认 PIN',
            value: confirm,
            onChange: function (e) {
              setConfirm(e.target.value);
            },
            style: INPUT,
          }),
        ),
        h('div', { style: ROW }, [
          h(
            'button',
            { style: Object.assign({}, BTN, busy ? BTN_DISABLED : null), disabled: busy, onClick: save },
            busy ? '保存中…' : enabled ? '更新 PIN' : '设置 PIN',
          ),
          msg ? h('span', { style: { fontSize: 12.5, opacity: 0.8 } }, msg) : null,
        ]),
      ]);
    }

    function PinCard() {
      return h('div', { style: CARD }, [
        h('div', { style: CARD_TITLE }, '访问 PIN'),
        h(
          'p',
          { style: MUTED },
          '手机通过隧道访问前需输入 PIN（至少 4 位）。公网暴露 DSH 有远程执行能力，请设置足够长的 PIN 并定期更换。',
        ),
        h(PinForm),
      ]);
    }

    function NotesCard() {
      return h('div', { style: CARD }, [
        h('div', { style: CARD_TITLE }, '说明'),
        h(
          'ul',
          { style: Object.assign({}, MUTED, { margin: '6px 0 0', paddingLeft: 18 }) },
          [
            h('li', null, '隧道由桌面端内嵌的 phone-sync 插件管理，退出应用时自动关闭。'),
            h('li', null, '移动端页面为优化视图（会话列表 / 详情 / 发消息 / 实时状态），路由在 /phn。'),
            h('li', null, '手机与电脑需都能访问外网（隧道经 Cloudflare 中转）。'),
          ],
        ),
      ]);
    }

    function PhoneSettingsPage() {
      var d = bridge();
      return h('div', { style: WRAP }, [
        h('div', null, [
          h('div', { style: { fontSize: 16, fontWeight: 700 } }, '📱 手机访问'),
          h(
            'p',
            { style: MUTED },
            '通过 Cloudflare 隧道把桌面端实时同步到手机浏览器（移动端优化页面，支持发消息）。',
          ),
        ]),
        d ? h(TunnelCard) : h('div', { style: CARD }, '请从 DSH Desktop 桌面应用打开本页以管理隧道与 PIN。'),
        d ? h(PinCard) : null,
        h(NotesCard),
      ]);
    }

    var HIDE_REMOTE_PHONE_CSS = [
      '/* Hide dsh-web-ui-all 移动端远程控制 (phone icon between 社区 and 检查更新).',
      '   Keep 检查更新. It duplicates @dshd/phone-sync. */',
      'button[aria-label="移动端远程控制"],',
      'button[title="移动端远程控制"],',
      'button[aria-label="Mobile remote control"],',
      'button[title="Mobile remote control"] { display: none !important; }',
    ].join('\n');

    function apply(ctx) {
      ctx.effect(function () {
        var tag = document.createElement('style');
        tag.setAttribute('data-plugin', 'phone-settings');
        tag.setAttribute('data-hide', 'remote-web-ui-phone');
        tag.textContent = HIDE_REMOTE_PHONE_CSS;
        document.head.appendChild(tag);
        return function () {
          if (tag.parentNode) tag.parentNode.removeChild(tag);
        };
      }, 'phone-settings: hide duplicate remote-web-ui phone entry');

      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: 'phone-settings',
            order: 210,
            label: function () {
              return '手机';
            },
          },
          function () {
            return h(PhoneSettingsPage);
          },
        );
      });
    }

    module.exports = {
      name: 'phone-settings',
      inject: ['slots'],
      apply,
    };
    return module.exports;
  },
});
