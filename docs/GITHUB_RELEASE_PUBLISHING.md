# GitHub Release 发布与大文件上传完整流程

本文面向“自己开发的软件”发布场景，重点解决“安装包超过 100MB 无法上传”的问题，并给出和 AutoInstallManager 集成的标准做法。

## 1. 先搞清楚 3 个大小限制

1. Git 仓库单文件硬限制：**100 MiB**（超过会被拒绝 push）。
2. Web 页面直接往仓库里 `Add file`：**25 MiB**。
3. GitHub Release 资产（asset）：单文件 **< 2 GiB**，单个 release 最多 1000 个资产，总体积不限。

结论：  
安装包（`.exe/.msi/.dmg/.zip`）不要提交到 Git 仓库，应该作为 **Release 资产** 上传。

## 2. 你需要准备什么

1. 一个 GitHub 仓库（建议公开仓库；当前项目对私有仓库下载支持有限）。
2. 本地安装 GitHub CLI：`gh`。
3. 你的打包产物，例如：
   - `dist/MyApp-1.2.3-win-x64.exe`
   - `dist/MyApp-1.2.3-mac-arm64.dmg`

## 3. 推荐发布规范（很关键）

1. Tag 使用语义化版本：`v1.2.3` 或 `1.2.3`（建议 `v1.2.3`）。
2. Release 文件名固定模式，包含版本和平台。
3. 每次发布同一版本只对应一个 tag，避免“同名 tag 反复改内容”。

AutoInstallManager 当前的 GitHub 版本解析基于 semver，tag 最好保持标准格式。

## 4. 手工发布（本地命令，最稳）

以下示例以版本 `1.2.3` 为例。

### 4.1 登录 GitHub CLI

```bash
gh auth login
```

### 4.2 创建并推送 tag

```bash
git tag v1.2.3
git push origin v1.2.3
```

### 4.3 先创建草稿 release

```bash
gh release create v1.2.3 \
  --draft \
  --verify-tag \
  --title "v1.2.3" \
  --notes "Release v1.2.3"
```

### 4.4 上传安装包资产（可超过 100MB）

```bash
gh release upload v1.2.3 \
  dist/MyApp-1.2.3-win-x64.exe \
  dist/MyApp-1.2.3-mac-arm64.dmg
```

### 4.5 检查资产是否上传成功

```bash
gh release view v1.2.3 --json url,assets
```

### 4.6 发布草稿 release

```bash
gh release edit v1.2.3 --draft=false
```

## 5. 自动发布（GitHub Actions）

当你 push tag（如 `v1.2.3`）时自动打包并上传 release 资产。

```yaml
name: release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build-and-release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: |
          mkdir -p dist
          echo "replace with your real build" > dist/placeholder.txt

      - name: Create release (draft)
        run: |
          gh release create "${GITHUB_REF_NAME}" \
            --draft \
            --verify-tag \
            --title "${GITHUB_REF_NAME}" \
            --notes "Auto release ${GITHUB_REF_NAME}"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload assets
        run: |
          gh release upload "${GITHUB_REF_NAME}" dist/* --clobber
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Publish release
        run: |
          gh release edit "${GITHUB_REF_NAME}" --draft=false
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## 6. 在 AutoInstallManager 里接入你的软件

在 `catalog/` 新建一个 yaml，例如 `catalog/myapp.yaml`：

```yaml
schemaVersion: "1.0.0"
id: "myapp"
name: "My App"
description: "My internal tool"
homepage: "https://github.com/your-org/myapp"
tags:
  - productivity

versionSource:
  type: githubReleases
  repo: your-org/myapp

assets:
  - platform: win
    arch: x64
    url: "https://github.com/your-org/myapp/releases/download/v{version}/MyApp-{version}-win-x64.exe"
    type: exe
  - platform: mac
    arch: arm64
    url: "https://github.com/your-org/myapp/releases/download/v{version}/MyApp-{version}-mac-arm64.dmg"
    type: dmg

install:
  type: exe
  requiresAdmin: true
  silentArgs: "/S"

validate:
  command: "myapp --version"
  parse: semver
```

然后执行：

```bash
npx tsx scripts/validate-catalog.ts
pnpm -r build
```

## 7. 常见问题排查

1. 报错 “file is larger than 100 MiB”
   - 你在往 Git 仓库提交二进制。改为上传到 Release 资产，不要 `git add dist/*.exe`。

2. 上传 release 资产失败
   - 先用 `gh release view <tag>` 看 release 是否存在。
   - 同名文件已存在时，用 `--clobber` 或先删除旧资产再传。

3. AutoInstallManager 看不到你新版本
   - 确认 release 已发布（不是 draft）。
   - 确认 tag 是 semver（如 `v1.2.3`）。
   - 确认 `assets.url` 模板和真实文件名一致。

4. 单文件超过 2 GiB
   - GitHub Release 不支持。改为拆分包，或改用对象存储/CDN，再在 catalog 里填外部下载链接。

5. 私有仓库 release 下载失败
   - 当前项目的 GitHub 版本解析/下载默认无鉴权，优先使用公开 release。

## 8. 官方参考

1. About large files on GitHub  
   https://docs.github.com/articles/distributing-large-binaries
2. About releases（含 release asset 配额）  
   https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
3. GitHub CLI `gh release create`  
   https://cli.github.com/manual/gh_release_create
4. GitHub CLI `gh release upload` / `gh release edit`  
   https://cli.github.com/manual/gh_release  
   https://cli.github.com/manual/gh_release_edit
