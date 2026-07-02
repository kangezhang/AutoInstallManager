# DevStack Manager

环境及软件自动管理安装工具，桌面端基于 Tauri 2 + Rust，前端基于 React + TypeScript + Vite。

## 功能概览

- 环境体检：扫描本机已安装的开发工具及版本
- 版本选择与安装：从工具定义中选择版本，自动下载、校验、解压和回滚
- 依赖检查：解析工具依赖关系
- GitHub 集成：仓库管理、Release 上传、Catalog 定义发布
- 跨平台支持：Windows / macOS / Linux，自动识别 x64 / arm64
- 可扩展 Catalog：通过 YAML 定义新工具

## 技术栈

- 桌面端：Tauri 2 + Rust
- 前端：React 18 + TypeScript + Vite + Zustand
- 包管理：pnpm workspace + Cargo
- 后端依赖：tokio、reqwest、git2、zip/tar
- Token 存储：AES-256-GCM 本地加密

## 项目结构

```text
DevStack Manager/
├─ apps/
│  └─ renderer/        # React + Vite 渲染进程
├─ packages/
│  └─ shared/          # 共享 TS 类型、Schema 和工具函数
├─ src-tauri/          # Tauri Rust 后端
│  ├─ src/
│  ├─ Cargo.toml
│  └─ tauri.conf.json
├─ catalog/            # 工具定义 YAML
├─ schemas/            # JSON Schema
├─ package.json
└─ pnpm-workspace.yaml
```

## 环境准备

1. 安装 Rust 1.77+：https://rustup.rs/
2. 安装 pnpm：

```bash
npm i -g pnpm
```

3. 安装平台依赖：

- Windows：Visual Studio Build Tools / MSVC 工具链
- macOS：Xcode Command Line Tools
- Linux：参考 Tauri 2 prerequisites 安装 WebKitGTK、OpenSSL、build-essential 等依赖

4. 安装项目依赖：

```bash
pnpm install
```

## 开发命令

```bash
# 启动完整 Tauri 开发环境
# 会先启动 apps/renderer 的 Vite dev server，再编译并启动 Tauri
pnpm dev

# 只启动前端，用浏览器调试 UI
pnpm renderer:dev

# 只构建前端产物
pnpm renderer:build

# 构建共享包
pnpm shared:build

# 监听构建共享包
pnpm --filter @devstack/shared dev
```

Tauri 开发模式默认使用：

- 前端地址：`http://localhost:5173`
- Rust 后端目录：`src-tauri/`
- 配置文件：`src-tauri/tauri.conf.json`

## 验证命令

```bash
# TypeScript 类型检查
pnpm typecheck

# ESLint
pnpm lint

# Vitest
pnpm test

# 格式化
pnpm format

# 只验证 Rust/Tauri 后端能否编译
cd src-tauri
cargo build --no-default-features
```

## 打包命令

```bash
# 构建当前平台安装包
# 会自动执行 tauri.conf.json 里的 beforeBuildCommand：
# pnpm --filter @devstack/renderer build
pnpm build

# 等价写法
pnpm tauri build

# Windows：只打 NSIS 安装包
pnpm tauri build --bundles nsis

# Windows：只打 MSI 安装包
pnpm tauri build --bundles msi

# Windows：同时打 NSIS 和 MSI
pnpm tauri build --bundles nsis,msi

# 只构建 release 可执行文件，不生成安装包
pnpm tauri build --no-bundle
```

打包输出目录：

```text
src-tauri/target/release/bundle/
```

Windows 常见输出子目录：

```text
src-tauri/target/release/bundle/nsis/
src-tauri/target/release/bundle/msi/
```

## 常用 Tauri 命令

```bash
# 查看 Tauri CLI 帮助
pnpm tauri --help

# 查看打包参数
pnpm tauri build --help

# 生成或更新应用图标
pnpm tauri icon icon_installer.ico
```

## 常见问题

### Windows 链接时报 `CVT1100: 资源重复。类型: MANIFEST`

不要在 `src-tauri/build.rs` 里额外调用 `embed_manifest`。Tauri 2 会生成自身的 Windows resource/manifest，手动嵌入会导致链接阶段出现重复 `MANIFEST` 资源。

如需声明 UAC 权限级别，应通过 `tauri_build::WindowsAttributes::app_manifest(...)` 交给 Tauri 统一写入 resource。

### Windows 运行时报 `请求的操作需要提升。 (os error 740)`

Windows 会对带有 `install`、`setup`、`manager` 等关键词的 exe 名称做安装器启发式检测。如果 manifest 没有明确声明权限级别，`dev-stack-manager.exe` 可能会被要求提权。

当前项目通过 `src-tauri/windows-app-manifest.xml` 声明启动时请求管理员权限，避免网络配置相关操作进入页面后再手动提权：

```xml
<requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
```

并在 `build.rs` 中通过 Tauri build API 注入：

```rust
fn main() {
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));
    let attrs = tauri_build::Attributes::new().windows_attributes(windows);

    tauri_build::try_build(attrs).expect("failed to run Tauri build script");
}
```

## License

MIT
