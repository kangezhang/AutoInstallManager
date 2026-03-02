# ADR 001: Monorepo 架构设计

## 状态

已接受

## 背景

AutoInstallManager 是一个复杂的 Electron 应用，包含主进程、渲染进程、核心业务逻辑、平台适配器等多个模块。需要一个清晰的代码组织结构来：

1. 分离关注点（UI、业务逻辑、平台适配）
2. 支持代码复用和模块化
3. 便于测试和维护
4. 支持未来扩展

## 决策

采用 Monorepo 架构，使用 pnpm workspace 管理多个包：

### 目录结构

```
AutoInstallManager/
├── apps/
│   ├── main/          # Electron 主进程
│   └── renderer/      # Electron 渲染进程（UI）
├── packages/
│   ├── core/          # 核心业务逻辑
│   ├── adapters/      # 平台适配器
│   └── shared/        # 共享类型和工具
```

### 模块边界规则

1. **apps/renderer**
   - 只能通过 IPC 调用能力
   - 不直接执行系统命令
   - 依赖：`@aim/shared`

2. **apps/main**
   - 负责 IPC 处理和任务调度
   - 依赖：`@aim/core`, `@aim/adapters`, `@aim/shared`

3. **packages/core**
   - 纯业务核心逻辑
   - 不依赖 Electron/Node GUI API
   - 保证可单测与可迁移
   - 依赖：`@aim/shared`

4. **packages/adapters**
   - 只实现平台能力差异
   - 不写业务规则
   - 依赖：`@aim/shared`

5. **packages/shared**
   - 类型定义、常量、错误码、IPC 协议
   - 不依赖其他包
   - 所有包都可以依赖它

### 依赖关系

```
renderer -> shared
main -> core, adapters, shared
core -> shared
adapters -> shared
```

## 优势

1. **清晰的模块边界**：每个包职责单一，易于理解和维护
2. **代码复用**：shared 包被所有模块共享
3. **独立测试**：core 和 adapters 可以独立测试，不依赖 Electron
4. **类型安全**：TypeScript 跨包类型检查
5. **构建优化**：只构建变更的包
6. **未来扩展**：可以轻松添加新的 packages（如 cli、server）

## 劣势

1. **初始配置复杂**：需要配置 pnpm workspace、TypeScript references
2. **构建时间**：多个包需要分别构建
3. **依赖管理**：需要注意包之间的版本一致性

## 替代方案

### 方案 A：单一仓库
将所有代码放在一个包中，使用文件夹分隔模块。

**拒绝理由**：
- 模块边界不清晰，容易出现循环依赖
- 难以独立测试和复用
- 不利于未来扩展

### 方案 B：多仓库
每个模块独立仓库。

**拒绝理由**：
- 版本管理复杂
- 跨仓库修改困难
- 本地开发体验差

## 实施

1. 创建 `pnpm-workspace.yaml` 配置
2. 为每个包创建独立的 `package.json` 和 `tsconfig.json`
3. 配置 TypeScript project references
4. 设置构建脚本（`pnpm -r build`）
5. 配置 ESLint 和 Prettier

## 参考

- [pnpm workspace](https://pnpm.io/workspaces)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [Monorepo Best Practices](https://monorepo.tools/)
