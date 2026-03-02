# 快速开始指南

## 当前状态

✅ Week 1: 架构冻结 (100%)
✅ Week 2: 工程骨架 (100%)
✅ Week 3: 合同与校验 (100%)

## Week 3 完成内容

### 1. JSON Schema 定义
- ✅ [schemas/tool-definition.schema.json](schemas/tool-definition.schema.json) - 工具定义 Schema
- ✅ [schemas/profile.schema.json](schemas/profile.schema.json) - 环境方案 Schema

### 2. Zod Schema 定义
- ✅ [packages/shared/src/schemas/tool-definition.ts](packages/shared/src/schemas/tool-definition.ts) - 工具定义类型
- ✅ [packages/shared/src/schemas/profile.ts](packages/shared/src/schemas/profile.ts) - 环境方案类型

### 3. Catalog 校验器
- ✅ [packages/core/src/catalog/validator.ts](packages/core/src/catalog/validator.ts) - 校验器实现
- ✅ [scripts/validate-catalog.ts](scripts/validate-catalog.ts) - 校验脚本

### 4. 示例 Catalog 文件
- ✅ [catalog/nodejs.yaml](catalog/nodejs.yaml) - Node.js 工具定义
- ✅ [catalog/git.yaml](catalog/git.yaml) - Git 工具定义

### 5. 验证校验器
```bash
# 运行校验脚本
npx tsx d:/Projects/AutoInstallManager/scripts/validate-catalog.ts

# 预期输出
🔍 Validating catalog files...
Directory: d:\Projects\AutoInstallManager\catalog
✅ All catalog files are valid!
```


## 下一步操作

### 1. 安装新增的依赖

由于我们新增了 `apps/main`、`apps/renderer`、`packages/core`、`packages/adapters` 包，需要重新安装依赖：

```bash
pnpm install
```

### 2. 构建所有包

验证所有包可以正常构建：

```bash
pnpm build
```

预期输出：
- `packages/shared` 构建成功
- `packages/core` 构建成功
- `packages/adapters` 构建成功
- `apps/main` 构建成功
- `apps/renderer` 构建成功

### 3. 启动开发环境

```bash
pnpm dev
```

这将同时启动：
- Vite 开发服务器（渲染进程）在 `http://localhost:5173`
- Electron 主进程（自动加载渲染进程）

### 4. 验证功能

启动后，你应该看到：

1. **Electron 窗口打开**
   - 窗口大小：1200x800
   - 开发者工具自动打开

2. **UI 正常渲染**
   - 左侧：深色侧边栏，显示 "AIM" 标题
   - 导航菜单：Dashboard、Catalog、Environment、Tasks
   - 右侧：主内容区域

3. **路由切换正常**
   - 点击侧边栏菜单项
   - URL 变化，页面内容切换
   - 当前页面高亮显示

4. **控制台输出**
   - 主进程控制台显示平台信息：
     ```
     Platform detected: {
       os: 'win',
       arch: 'x64',
       version: '...',
       isAdmin: false,
       paths: { ... }
     }
     ```

---

## 常见问题

### Q1: `pnpm install` 失败

**解决方案**:
```bash
# 清理缓存
pnpm store prune

# 重新安装
pnpm install
```

### Q2: 构建失败，提示找不到模块

**解决方案**:
```bash
# 清理所有 dist 目录
rm -rf apps/*/dist packages/*/dist

# 重新构建
pnpm build
```

### Q3: Electron 窗口无法打开

**解决方案**:
1. 检查 `apps/main/dist/index.js` 是否存在
2. 确保先运行 `pnpm build`
3. 查看终端错误信息

### Q4: Vite 开发服务器启动失败

**解决方案**:
```bash
# 检查端口 5173 是否被占用
netstat -ano | findstr :5173

# 如果被占用，修改 apps/renderer/vite.config.ts 中的端口
```

---

## 开发工作流

### 日常开发

```bash
# 1. 启动开发环境
pnpm dev

# 2. 修改代码（自动热重载）
# - 修改 apps/renderer/src/** 文件 → Vite HMR
# - 修改 apps/main/src/** 文件 → 需要重启 Electron

# 3. 代码检查
pnpm lint

# 4. 格式化代码
pnpm format

# 5. 类型检查
pnpm typecheck
```

### 添加新依赖

```bash
# 为特定包添加依赖
pnpm --filter @aim/renderer add react-query

# 为所有包添加开发依赖
pnpm add -Dw vitest
```

### 构建生产版本

```bash
# 构建所有包
pnpm build

# 打包 Electron 应用（待配置）
pnpm package
```

---

## 项目命令速查

| 命令 | 说明 |
|------|------|
| `pnpm install` | 安装所有依赖 |
| `pnpm dev` | 启动开发环境 |
| `pnpm build` | 构建所有包 |
| `pnpm test` | 运行测试 |
| `pnpm lint` | 代码检查 |
| `pnpm format` | 格式化代码 |
| `pnpm typecheck` | 类型检查 |
| `npx tsx d:/Projects/AutoInstallManager/scripts/validate-catalog.ts` | 校验 catalog 文件 |
| `pnpm -r list` | 列出所有包的依赖 |

---

## 下一步开发（Week 4）

完成 Week 3 后，可以开始 Week 4 的工作：

1. **Catalog 加载器**
   - 实现 catalog 文件加载
   - 平台过滤（win/mac + x64/arm64）
   - 版本源解析（GitHub Releases）

2. **版本管理**
   - 实现 GitHub Releases 版本获取
   - 版本列表缓存
   - 版本比较和排序


---

## 需要帮助？

查看文档：
- [实施计划](C:\Users\zhangkang\.claude\plans\glimmering-discovering-rossum.md)
- [实施进度](docs/roadmap/implementation-progress.md)
- [实施总结](docs/roadmap/implementation-summary.md)
- [ADR 文档](docs/ADR/)

---

**祝开发顺利！** 🚀
