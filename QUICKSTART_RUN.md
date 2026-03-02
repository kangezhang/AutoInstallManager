# 快速启动指南

## 方法 1：使用 pnpm electron（推荐）

```bash
# 构建并运行
pnpm electron
```

这会自动构建所有包并启动 Electron 应用。

## 方法 2：分步执行

```bash
# 1. 构建所有包
pnpm build

# 2. 启动 Electron
pnpm start
```

## 方法 3：开发模式

```bash
# 启动开发服务器（热重载）
pnpm dev
```

这会同时启动：
- Vite 开发服务器（端口 5173）
- Electron 主进程（监听模式）

## 故障排除

### 问题：Electron 安装失败

如果看到 "Electron failed to install correctly" 错误：

```bash
# 删除 node_modules 并重新安装
rm -rf node_modules
pnpm install
```

或者批准构建脚本：

```bash
pnpm approve-builds
# 选择 electron 和 esbuild
# 然后运行
pnpm install
```

### 问题：找不到 catalog 目录

确保在项目根目录运行命令，catalog 文件夹应该在根目录下。

### 问题：Preload 脚本未加载

确保已经构建了 preload 包：

```bash
pnpm --filter @aim/preload build
```

## 验证安装

运行测试脚本验证核心功能：

```bash
pnpm tsx scripts/test-e2e.ts
```

## 项目结构

```
AutoInstallManager/
├── apps/
│   ├── main/dist/          # 主进程构建输出
│   ├── preload/dist/       # Preload 构建输出
│   └── renderer/dist/      # 渲染进程构建输出
├── catalog/                # 工具定义文件
└── packages/               # 核心包
```

## 开发工作流

1. 修改代码
2. 如果修改了 packages，运行 `pnpm -r build`
3. 如果修改了 apps/renderer，Vite 会自动热重载（开发模式）
4. 如果修改了 apps/main 或 apps/preload，需要重启 Electron

## 下一步

- 查看 [RUNNING.md](./RUNNING.md) 了解详细说明
- 查看 [PROJECT_STATUS.md](./PROJECT_STATUS.md) 了解项目状态
