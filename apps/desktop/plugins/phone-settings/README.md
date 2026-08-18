# @dshd/phone-settings

DSH Desktop 壳内「手机访问」设置页插件：

- **设置 → 手机**：隧道状态（启动/停止/复制地址）+ 访问 PIN（状态/设置/更新），全部内嵌在官方 Web UI 的设置页里。
- **不再跳页**：不切换桌面壳渲染器，不打开新窗口，设置面板自带关闭按钮，天然可回退。

实现：client 半区注册 `settings.section`（id: phone-settings, order: 210, label: 手机）。
隧道控制走桌面 preload 桥 `window.desktop.phoneStatus/phoneStart/phoneStop`，
PIN 管理走 `window.desktop.pinStatus/pinSet`（与桌面壳内旧 PhonePanel 同一 IPC）。
在纯 `dsh web`（无桌面桥）下会显示提示而非报错。host 半区为 no-op。

## 挂载方式

与 `@dshd/phone-sync` / `@dshd/community-links` 相同：桌面壳启动时把本目录
link 进 `$DSH_HOME/profiles/web/node_modules/@dshd/phone-settings`，并在该
profile 的 `cordis.patch.yml` insert 列表声明
`{ id: phone-settings, name: '@dshd/phone-settings' }`。

## 手动安装（当前实例即时生效）

```sh
ln -s "$(pwd)" ~/.dsh/profiles/web/node_modules/@dshd/phone-settings
```

然后在 `~/.dsh/profiles/web/cordis.patch.yml` 的 insert 列表追加一行，
重启桌面壳（或 `dsh web`）生效。
