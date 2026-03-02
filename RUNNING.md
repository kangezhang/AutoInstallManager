# 运行指南

## 开发环境运行

### 1. 安装依赖
```bash
pnpm install
```

### 2. 构建所有包
```bash
pnpm -r build
```

### 3. 启动开发服务器

在两个终端中分别运行：

**终端 1 - 启动渲染进程开发服务器：**
```bash
cd apps/renderer
pnpm dev
```

**终端 2 - 启动 Electron 主进程：**
```bash
cd apps/main
pnpm dev
```

或者使用根目录的快捷命令：
```bash
pnpm dev
```

### 4. 访问应用

Electron 窗口会自动打开，显示应用界面。

## 仅浏览器预览（无 Electron 功能）

如果只想预览 UI（不连接后端功能）：

```bash
cd apps/renderer
pnpm dev
```

然后访问 http://localhost:5173

**注意**：在浏览器模式下，所有 Electron API 调用会被跳过，显示"Electron API not available"错误。

## 构建生产版本

```bash
pnpm build
```

## 运行测试

### 端到端测试
```bash
pnpm tsx scripts/test-e2e.ts
```

### Catalog 验证
```bash
pnpm validate:catalog
```

## 故障排除

### 问题：Preload 脚本未加载
确保主进程配置了正确的 preload 路径：
```typescript
preload: path.join(__dirname, '../../preload/dist/index.js')
```

### 问题：模块未找到
运行构建命令：
```bash
pnpm -r build
```

### 问题：端口已被占用
修改 `apps/renderer/vite.config.ts` 中的端口配置。

## 项目结构

```
AutoInstallManager/
├── apps/
│   ├── main/          # Electron 主进程
│   ├── preload/       # Preload 脚本
│   └── renderer/      # React 前端
├── packages/
│   ├── shared/        # 共享类型
│   ├── core/          # 核心业务逻辑
│   └── adapters/      # 平台适配器
├── catalog/           # 工具定义文件
└── scripts/           # 测试脚本
```

## 开发工作流

1. 修改代码
2. 如果修改了 packages，运行 `pnpm -r build`
3. 如果修改了 apps/renderer，Vite 会自动热重载
4. 如果修改了 apps/main 或 apps/preload，需要重启 Electron

## 下一步

- 修复 E2E 测试中的 API 参数问题
- 添加更多工具定义到 catalog/
- 实现完整的安装流程
- 优化 UI 样式
