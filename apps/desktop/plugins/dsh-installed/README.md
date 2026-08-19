# @dshd/dsh-installed

设置 → **插件 → 已安装**：列出你后来自己装上的插件和技能（中文简述）。「检查更新」之后可以「更新本机功能」（只动还在用的），或「完整更新」勾选要升级的项。已经去掉的功能默认不会被加回来。

这不是插件市场。1024 Store / 社区插件市场在 web profile 里被停用，本插件只读账本。

## 挂载

与 `@dshd/community-links` 相同：把本目录 link 进

`$DSH_HOME/profiles/web/node_modules/@dshd/dsh-installed`

并在该 profile 的 `cordis.patch.yml` insert 列表声明

`{ id: dsh-installed, name: '@dshd/dsh-installed' }`。

同时停用：

```yaml
- id: dsh1024
  disabled: true
- id: web-ui-community-plugins
  disabled: true
```

重启 `dsh web` / 桌面壳后生效。

## 测试

```sh
node --test tests/*.test.js
```
