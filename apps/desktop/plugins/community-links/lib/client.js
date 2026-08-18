/* @dshd/community-links client bundle — DeepSeek Harness Web UI.
 * Registered in the web-app's client module loader (same format as
 * dsh-context / dsh-better-sidebar):
 *   - settings.section "社区": a settings page with community resource cards
 *   - sidebar.footer.action: a compact footer entry opening DSH 1024Store
 * Links open in the system browser via target="_blank" anchors (the desktop
 * shell forwards window-open to shell.openExternal).
 */
window.__ModuleLoader__.load({
  id: '@dshd/community-links',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var h = React.createElement;

    var LINKS = [
      {
        title: 'Awesome DeepSeek Harness',
        desc: '插件 / 工具 / 基础设施精选列表',
        url: 'https://deepseekdocs.com/',
      },
      {
        title: 'DSH 1024Store',
        desc: '社区插件目录 4120+ · 在线插件市场与公开查询 API',
        url: 'https://deepseek1024.com/',
      },
      {
        title: 'dshfind',
        desc: 'DSH 学习与分享社区 · 原理课程 · 插件市场',
        url: 'https://dshfind.com/',
      },
      {
        title: 'DeepSeek Harness 橙皮书',
        desc: '社区实测手册《从开机到拆开》',
        url: 'https://github.com/alchaincyf/deepseek-harness-orange-book',
      },
    ];

    // Neutral styles that read well on both light and dark themes.
    var WRAP = { display: 'flex', flexDirection: 'column', gap: 12 };
    var PAGE_TITLE = { fontSize: 16, fontWeight: 700, lineHeight: 1.4 };
    var PAGE_SUB = { fontSize: 13, opacity: 0.55, marginTop: -4 };
    var LIST = { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 };
    var CARD = {
      display: 'block',
      border: '1px solid rgba(148, 163, 184, 0.25)',
      borderRadius: 10,
      padding: '12px 14px',
      textDecoration: 'none',
      color: 'inherit',
      background: 'rgba(148, 163, 184, 0.06)',
      transition: 'background 120ms ease',
    };
    var CARD_TITLE = { fontSize: 14, fontWeight: 600 };
    var CARD_DESC = { fontSize: 12, opacity: 0.65, marginTop: 4 };
    var FOOTER = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 8px',
      fontSize: 13,
      color: 'inherit',
      textDecoration: 'none',
      borderRadius: 6,
      cursor: 'pointer',
    };

    function card(link) {
      return h(
        'a',
        { key: link.url, href: link.url, target: '_blank', rel: 'noreferrer', style: CARD },
        h('div', { style: CARD_TITLE }, link.title),
        h('div', { style: CARD_DESC }, link.desc),
      );
    }

    function CommunityPage() {
      return h('div', { style: WRAP }, [
        h('div', { style: PAGE_TITLE }, '社区资源'),
        h('div', { style: PAGE_SUB }, 'DeepSeek Harness 生态精选入口 —— 点击在系统浏览器打开'),
        h('div', { style: LIST }, LINKS.map(card)),
      ]);
    }

    function FooterAction() {
      return h(
        'a',
        {
          href: 'https://deepseek1024.com/',
          target: '_blank',
          rel: 'noreferrer',
          style: FOOTER,
          title: '社区资源：1024 Store / Awesome DSH / dshfind / 橙皮书',
        },
        '🌐 社区',
      );
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          {
            name: 'settings.section',
            id: 'community-links',
            order: 200,
            label: function () {
              return '社区';
            },
          },
          function () {
            return h(CommunityPage);
          },
        );
      });
      ctx.slots.inject('sidebar.footer.action', function () {
        return ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'community-links',
            order: 50,
            label: function () {
              return '社区资源';
            },
          },
          function () {
            return h(FooterAction);
          },
        );
      });
    }

    module.exports = {
      name: 'community-links',
      inject: ['slots'],
      apply,
    };
    return module.exports;
  },
});
