# @dshd/community-links

DSH Desktop 壳内「社区资源」入口插件：

- **设置 → 社区**：卡片列出 Awesome DeepSeek Harness（deepseekdocs.com）、DSH 1024Store（deepseek1024.com）、dshfind、DeepSeek Harness 橙皮书。
- **侧边栏底部**：🌐 社区 快捷入口（直达 DSH 1024Store）。

实现：client 半区注册 `settings.section` 与 `sidebar.footer.action` 两个 Slot；链接用 `target="_blank"` 锚点，由桌面壳转发到系统浏览器，不需要任何 IPC。host 半区为 no-op。

## 挂载方式

与 `@dshd/phone-sync` 相同：桌面壳启动时把本目录 link 进
`$DSH_HOME/profiles/web/node_modules/@dshd/community-links`，
并在该 profile 的 `cordis.patch.yml` insert 列表声明
`{ id: community-links, name: '@dshd/community-links' }`。

## 手动安装（当前实例即时生效）

```sh
ln -s "$(pwd)" ~/.dsh/profiles/web/node_modules/@dshd/community-links
```

然后在 `~/.dsh/profiles/web/cordis.patch.yml` 的 insert 列表追加一行，
重启桌面壳（或 `dsh web`）生效。
