# AutoInstallManager

环境及软件自动管理安装工具 - 像软件商店一样管理开发环境

## 功能特性

- **环境体检**：扫描本机已安装的开发工具（Node、Git、CMake 等）及其版本、路径、健康状态
- **版本选择与安装**：从官方源选择版本、自动下载安装、校验、回滚
- **依赖检查**：自动解析工具依赖关系（DAG）
- **方案管理**：导入导出环境配置（如"Web+Tauri"、"C++ Toolchain"）
- **跨平台支持**：Win + macOS 双平台自动识别（x64/arm64）
- **可扩展性**：通过 YAML 定义新工具，无需修改主程序

## 技术栈

- **包管理器**: pnpm（workspace 支持 monorepo）
- **构建工具**: Vite（renderer）+ tsup（packages）+ electron-builder（打包）
- **UI 框架**: React 18 + TypeScript
- **状态管理**: Zustand
- **IPC 通信**: electron-trpc
- **Schema 验证**: Zod + JSON Schema
- **本地存储**: better-sqlite3
- **YAML 解析**: js-yaml
- **日志**: pino

## 项目结构

```
AutoInstallManager/
├── apps/
│   ├── main/          # Electron 主进程
│   └── renderer/      # Electron 渲染进程（UI）
├── packages/
│   ├── core/          # 核心业务逻辑
│   ├── adapters/      # 平台适配器
│   └── shared/        # 共享类型和工具
├── catalog/           # 工具定义文件
├── schemas/           # JSON Schema 文件
├── tests/             # 测试
└── docs/              # 文档
```

## 开发

```bash
# 安装依赖
pnpm install

# 启动开发环境
pnpm dev

# 构建
pnpm build

# 运行测试
pnpm test

# 代码检查
pnpm lint

# 格式化代码
pnpm format
```

## 开发计划

详见 [快速开始指南](QUICKSTART.md)

### 当前进度

✅ **Week 1: 架构冻结** (100%)
- 分层依赖图、模块边界、IPC 合同草案、错误码规范

✅ **Week 2: 工程骨架** (100%)
- Monorepo 结构、基础构建配置、Electron 应用框架

✅ **Week 3: 合同与校验** (100%)
- JSON Schema 定义
- Zod Schema 定义
- Catalog 校验器实现
- 示例工具定义（Node.js, Git）

✅ **Week 4: Catalog MVP** (100%)
- Catalog 加载器
- 平台过滤（win/mac + x64/arm64）
- GitHub Releases 版本解析
- 版本比较和排序

🚧 **Week 5: Scanner MVP** (进行中)
- 环境扫描器
- 健康报告模型
- 冲突检测

### Phase 0-1（Week 1-4）

- ✅ Week 1: 架构冻结
- ✅ Week 2: 工程骨架
- ✅ Week 3: 合同与校验
- ✅ Week 4: Catalog MVP

### Phase 2（Week 5-6）

- Scanner MVP
- 健康报告模型
- 冲突检测

## 文档

- [架构决策记录（ADR）](docs/ADR/)
- [开发路线图](docs/roadmap/)

## License

MIT
