环境及软件自动管理安装工具
=============

我想要开发个管理工具，可以查看当前电脑环境情况，允许选择官网版本，允许检查依赖，可以像个软件商店那样安装部署，支持未来扩展，请为我设计一个这样的开发规划，使用electron

Response:
---------

下面给你一套**可落地、可扩展、像“软件商店”一样的环境管理工具**的开发规划（Electron）。我会按你关心的点来：**查看环境、选择官网版本、检查依赖、安装部署、未来可扩展**，并且设计成你后续能持续加“新包/新工具”的体系。

（遵守你的偏好：界面描述里不使用任何艺术字/花体 icon 字体；图标用 SVG/PNG 资源或系统图标。）

* * *

1\. 产品定位与核心体验
-------------

### 核心目标

做一个“开发环境软件商店 + 体检中心”：

*   **体检**：扫描本机已安装的软件/运行时/SDK/工具链（版本、路径、健康状态）
    
*   **推荐**：基于项目类型（Web、Tauri、Electron、C++、Android、Unity/UE 工具链等）给出“必装清单”
    
*   **安装**：从官方来源（或你配置的镜像）下载并安装，带进度、校验、回滚
    
*   **一致性**：支持版本钉死（Node 20.x、Python 3.12.x、CMake 3.29.x…），可导入/导出“环境方案”
    
*   **扩展性**：未来添加新工具，不改主程序，只加一个“插件/包定义”
    

### MVP 必须做到的闭环

*   扫描 → 展示 → 选择版本 → 安装 → 校验 → 记录到本地“已管理状态”
    

* * *

2\. 总体架构（Electron + 插件化）
------------------------

### Electron 进程职责

*   **Renderer（UI）**：页面、状态展示、任务队列、搜索/筛选/版本选择
    
*   **Main（调度）**：任务编排、权限提升、下载、安装、校验、日志、IPC
    
*   **Worker（可选）**：解压/哈希校验/扫描（避免阻塞主线程）
    

### 关键子系统（建议分包/分模块）

1.  **Environment Scanner（环境扫描）**
    
    *   统一产出：`ToolDetected {name, version, path, source, health}`
        

*   扫描方式：
    
    *   PATH 命令探测（`node -v`, `cmake --version`…）
        
    *   注册表/系统目录（Windows）
        
    *   brew list / pkgutil（macOS）
        
    *   apt/dpkg/rpm（Linux，可后置）
        
*   输出“健康状态”：
    
    *   未安装
        
    *   版本过低/过高（不符合方案）
        
    *   路径异常
        
    *   依赖缺失（例如 Git 缺失导致 pnpm install 失败）
        
        2.  **Catalog（“软件商店”目录）**
            
    *   目录数据结构建议做成 JSON/YAML + 签名（后面讲安全）
        
*   每个工具包含：
    
    *   官网来源（主页/下载页/Release API）
        
    *   可选版本列表获取策略（静态 / 解析网页 / GitHub Releases / 自有镜像 API）
        
    *   安装策略（exe/msi/pkg/zip/tar，命令行参数，silent install）
        
    *   校验策略（sha256、签名、版本检测命令）
        
    *   依赖关系（例如 Android SDK 依赖 Java，Tauri 依赖 Rust）
        
        3.  **Installer Engine（安装引擎）**
            
    *   把安装抽象为统一流水线（非常关键，决定可扩展性）：
        
    *   resolve → download → verify → install → postInstall → validate → register
        
*   支持安装类型：
    
    *   **Silent Installer**（Windows exe/msi，macOS pkg）
        
    *   **Archive Install**（zip/tar 解压到指定目录）
        
    *   **Package Manager Bridge**（可选：winget/brew/apt 作为一种安装后端）
        
*   具备能力：
    
    *   断点续传、并发下载
        
    *   哈希校验
        
    *   失败回滚（删除已解压目录、记录失败原因）
        
    *   权限提升（Windows UAC / macOS sudo）——尽量在需要时才提升
        
        4.  **Dependency Resolver（依赖解析）**
            
    *   DAG 依赖图：先装依赖再装目标
        
*   支持“条件依赖”：OS、架构、已存在版本、用户选择偏好
    
*   输出可解释的“为什么要装这个”
    
    5.  **Profiles / Plans（环境方案）**
        
    
    *   “方案” = 一组工具+版本+约束
        
*   例子：`Web+Tauri`、`C++ Toolchain`、`Ainold Editor Dev` 等
    
*   支持：
    
    *   导入/导出（JSON）
        
    *   一键对齐：把机器调整到方案要求
        
        6.  **Plugin System（扩展机制）**  
            两种路线都可行，我建议你从轻到重：
            
    *   **方案 A（最省心，首选）**：插件就是“包定义文件”
        
    *   每个工具一个 `package.yaml/json`
        
    *   主程序提供通用安装器、通用扫描器，包定义只写“怎么获取版本、怎么装、怎么检测”
        
    *   优点：安全、可控、维护成本低
        
*   **方案 B（高级，可后置）**：插件允许执行 JS/TS 脚本
    
    *   适合复杂逻辑（比如解析特殊网页、公司内网鉴权下载）
        
    *   风险：安全面更大，需要沙箱/签名/权限系统
        

> 你的目标是“未来扩展”，但也要“安全可控”。所以：先用 A，等确实需要再上 B。

7.  **Telemetry & Logs（日志与可诊断性）**
    
    *   本地日志（按任务 ID）
        

*   失败可一键复制诊断信息（路径、命令输出、错误码、网络状态）
    
*   可选：匿名统计（后置）
    

* * *

3\. 数据模型（让系统“工程化”起来）
--------------------

### Tool（工具）定义（示意）

*   `id`: "nodejs"
    
*   `displayName`: "Node.js"
    
*   `homepage`: ...
    
*   `versionSource`: { type: "githubReleases", repo: "nodejs/node" } 或 "staticList"
    
*   `assets`: 规则：按 OS/arch 匹配下载包
    
*   `install`: { type: "msi", silentArgs: "...", requiresAdmin: true }
    
*   `validate`: { command: "node -v", parse: "semver" }
    
*   `dependencies`: \["vc\_redist", "git"\]（示例）
    
*   `tags`: \["runtime", "javascript"\]
    

### Task（任务）模型

*   `taskId`
    
*   `toolId`
    
*   `steps`: download/verify/install/validate...
    
*   `state`: queued/running/succeeded/failed/cancelled
    
*   `progress`: 0..1 + 当前 step 进度
    
*   `logs`: stream
    

* * *

4\. UI 信息架构（像“商店”但更偏工程）
-----------------------

### 主要页面

1.  **Dashboard**
    
    *   本机健康评分（必装缺失数、版本不符合数）
        

*   最近任务
    
*   快捷：按方案一键对齐
    
    2.  **Catalog（商店）**
        
    
    *   分类 + 搜索
        
*   工具卡片：已安装/未安装、当前版本、推荐版本
    
*   进入详情：版本选择、来源说明（官网/镜像）、依赖提示
    
    3.  **Environment（环境体检）**
        
    
    *   以“工具链视角”展示：
        
    *   Runtime（Node/Python/Java）
        
    *   Build（CMake/Ninja/MSVC/Clang）
        
    *   VCS（Git）
        
    *   Mobile（Android SDK）
        
*   每项可展开：检测到的路径、环境变量、冲突项（多版本）
    
    4.  **Tasks（任务队列）**
        
    
    *   多任务并行、可暂停/取消
        
*   失败原因清晰可读（不是只给 error code）
    
    5.  **Profiles（方案）**
        
    
    *   方案列表，支持导入导出
        
*   “应用方案”：列出将要执行的变更（将安装/将升级/将降级/将卸载）
    

### UI 原则（给你的工程师/设计师）

*   以“信息密度 + 可解释性”为主
    
*   绝不使用花体 icon 字体；图标采用统一 SVG 资源或系统图标
    
*   所有动作必须可回溯：谁触发、装了什么、从哪下的、校验结果
    

* * *

5\. 安全与可信（非常关键）
---------------

你说“允许选择官网版本”，那就必须考虑供应链安全：

1.  **来源白名单**
    
    *   默认只允许：
        
    *   官方域名
        
    *   官方 GitHub Releases
        
    *   你配置的镜像域名
        
        2.  **校验**
            
    *   sha256 校验（强烈建议）
        

*   能拿到签名就验证签名（Windows Authenticode / macOS 签名）
    
    3.  **插件签名**
        
    
    *   包定义文件（catalog）做签名（至少 HMAC/公私钥签名）
        
*   防止被篡改后下发恶意下载地址
    
    4.  **权限最小化**
        
    
    *   能不提权就不提权
        
*   需要提权时明确提示原因（安装到 Program Files / 写系统目录等）
    

* * *

6\. 开发规划（Phase 0 → Phase 5）
---------------------------

### Phase 0：工程骨架（1-2 周级别的工作量）

*   Electron 工程：主进程/渲染进程/IPC 框架
    
*   状态管理（任务队列、日志流）
    
*   本地数据库/存储（建议 SQLite 或轻量 JSON + 后续迁移）
    
*   基础 UI：Dashboard + Catalog 列表 + Task 列表
    

交付物：

*   能跑起来的壳 + 假数据驱动 UI
    
*   任务队列 UI 可演示
    

* * *

### Phase 1：环境扫描 MVP（2-3 周）

*   实现 5-8 个核心工具的扫描：
    
    *   Node, npm/pnpm, Git, Python, CMake, VS Build Tools（Windows）, Xcode CLT（macOS）
        
*   输出统一检测报告
    
*   UI 展示 + 导出 JSON
    

交付物：

*   “环境体检”页面可用
    
*   诊断信息可复制
    

* * *

### Phase 2：目录系统 Catalog MVP（2-3 周）

*   设计 `tool package.json/yaml` 格式
    
*   实现版本源：
    
    *   静态版本列表
        
    *   GitHub Releases（足够覆盖很多工具）
        
*   目录 UI：工具详情页 + 版本选择
    
*   本地目录缓存
    

交付物：

*   能从目录看到版本列表并选择（但不一定安装）
    

* * *

### Phase 3：安装引擎 MVP（3-5 周）

先支持“最通用”的两类安装：

*   Archive Install（zip 解压）
    
*   Windows MSI/EXE silent（选几个典型工具）
    

实现通用流水线：

*   download（进度）→ verify（sha256）→ install → validate（命令检查）→ register
    

先做 3 个工具闭环：

*   Node.js（建议先用 zip/解压版或 msi）
    
*   Git
    
*   CMake
    

交付物：

*   从目录点安装，能正确装完并被扫描识别
    
*   有失败回滚和日志
    

* * *

### Phase 4：依赖解析 + 方案（3-4 周）

*   依赖图：例如 Tauri 方案依赖 Rust + Node + WebView2（Windows）
    
*   方案系统：
    
    *   创建/编辑方案
        
    *   一键对齐（只装缺失/升级不符合项）
        
*   导入导出方案
    

交付物：

*   “Web+Tauri 一键准备环境”这种体验
    

* * *

### Phase 5：扩展系统与发布（长期演进）

*   Catalog 签名与远程更新
    
*   插件（包定义）热加载
    
*   更多安装后端：
    
    *   winget/brew bridge（可选）
        
*   卸载/清理策略（谨慎做，避免误删用户原装）
    
*   企业/团队能力：
    
    *   内网镜像源
        
    *   团队共享方案
        
    *   离线缓存
        

交付物：

*   可持续扩展的“环境商店生态”
    

* * *

7\. 技术选型建议（稳而不花）
----------------

*   UI：React + TypeScript（或你也可以 Vue，但 Electron+工具类偏 React 生态更丰富）
    
*   状态：Zustand / Redux Toolkit（二选一，偏工程我会选 RTK 或 Zustand）
    
*   网络下载：主进程用 Node 流 + 断点续传
    
*   解压：主进程解压库（zip/tar）
    
*   哈希：crypto sha256
    
*   本地存储：SQLite（better-sqlite3）或先 JSON（后续迁移）
    
*   进程间通信：IPC + 明确协议（request/response + event stream）
    

* * *

8\. 给你一份“可扩展”的目录包定义示例（概念）
-------------------------

你未来新增一个工具，只需要加一个文件：

*   `catalog/nodejs.yaml`
    
*   `catalog/git.yaml`
    

每个定义包含：

*   如何拿版本（githubReleases / static / customUrl）
    
*   如何选资产（win-x64/mac-arm64）
    
*   如何安装（msi/exe/pkg/zip）
    
*   如何验证（命令 + 解析）
    

这样你就能像“商店上架”一样持续扩展。

* * *

9\. 你这个工具的“差异化亮点”（对你很重要）
------------------------

你不是做 winget/brew 的替代品，你要做的是：

*   **面向“项目/方案”的一致环境**（而不是面向“单工具安装”）
    
*   **可解释的诊断**（TA/工程团队非常需要）
    
*   **可扩展的 Catalog**（你可以把 Ainold 自己的工具链也上架）
    
*   **跨平台一致体验**（Windows/macOS 先做，Linux 后置）
    

* * *

如果你愿意，我下一步可以直接给你：

1.  **仓库结构建议**（packages/main, packages/renderer, packages/shared, catalog/…）
    
2.  **IPC 协议设计**（scan/install/tasks/log stream 的接口）
    
3.  **Tool 包定义 schema（JSON Schema）**，确保插件扩展时不会乱
    
4.  先挑 3 个工具（Node/Git/CMake）把“闭环”跑通的具体实现路线图
    

你更想先从 **Windows-only 快速 MVP** 起步，还是一开始就 **Win+mac 双平台**？我不需要你确认太多细节，但这个选择会影响安装方式（msi/pkg/zip）优先级。

Prompt:
-------

一开始就 Win+mac 双平台（自动判断）

Response:
---------

行，那就按 **“Win + mac 双平台同一套逻辑，启动时自动判断 OS/CPU 架构，Catalog 自动匹配安装包”** 来设计。下面给你一份可以直接开工的开发规划（偏工程化、可扩展、后续能持续上架工具）。

* * *

0\. 目标与边界
---------

### 你要做到的“商店式体验”

*   自动识别：Windows / macOS + x64 / arm64
    
*   环境体检：已装什么、版本多少、路径在哪、是否健康
    
*   版本选择：展示“官方可用版本列表”，默认推荐 LTS/稳定
    
*   依赖检查：装某工具前先把依赖链算清楚（并解释原因）
    
*   一键安装：下载 → 校验 → 安装 → 验证 → 纳入“已管理”
    
*   可扩展：未来新增一个工具 ≈ 新增一个“包定义文件”（尽量不改主程序）
    

### 不建议 MVP 就做的事（后置）

*   全量卸载/清理（很容易误删用户原装）
    
*   任意脚本插件（安全面爆炸，后期再做并加签名/沙箱）
    
*   Linux（你已说先 Win+mac）
    

* * *

1\. 跨平台总体架构
-----------

### Electron 分层

*   Renderer：商店 UI、体检 UI、任务队列、方案管理
    
*   Main：扫描、安装调度、下载校验、权限提升、日志、Catalog 解析
    
*   Worker（可选）：解压、哈希、重扫描（避免阻塞 Main）
    

### 平台适配的核心原则

**主程序只做“统一流程”，平台差异全部塞进 adapter：**

*   `PlatformInfo`：`os = win|mac`，`arch = x64|arm64`
    
*   `ScannerAdapter`：每个工具如何检测
    
*   `InstallerAdapter`：不同安装包类型如何安装/验证
    
*   `PrivilegeAdapter`：需要管理员/ sudo 时如何提升
    

这样你以后扩展 Linux 也是加一套 adapter，不动上层逻辑。

* * *

2\. 目录（Catalog）设计：自动匹配 Win/Mac 包
--------------------------------

### Tool 包定义（建议 JSON/YAML + JSON Schema 校验）

每个工具一份文件，比如：

*   `catalog/nodejs.yaml`
    
*   `catalog/git.yaml`
    
*   `catalog/cmake.yaml`
    

Tool 定义必须包含这些字段（MVP 级别）：

1.  基本信息
    
    *   `id` / `name` / `homepage` / `description` / `tags`
        
    
    2.  版本来源（官方）
        
    
    *   `versionSource`（多种策略）：
        
    *   `githubReleases`（最通用，覆盖大量工具）
        
    *   `staticList`（固定版本）
        
    *   `customJsonFeed`（你自己做个小服务聚合官方版本也行）
        
        3.  资产匹配（关键：自动判断）
            
    *   `assets[]`：按 `os + arch` 匹配下载包
        

*   规则支持：
    
    *   win/x64 → `.msi` 或 `.zip`
        
    *   mac/arm64 → `.pkg` 或 `.tar.gz`
        
    *   mac/x64 → `.pkg` 或 `.tar.gz`
        
        4.  安装策略
            
    *   `install.type`：`msi|exe|pkg|archive`
        
*   `install.requiresAdmin`：true/false
    
*   `install.silentArgs`（win）
    
*   `install.targetDir`（archive 安装用）
    
*   `postInstall`（可选：设置 PATH、写 shim、刷新缓存）
    
    5.  验证策略
        
    
    *   `validate.command`：比如 `node -v`
        
*   `validate.parse`：`semver`（解析版本）
    
*   `healthHints`：提示常见错误（PATH 没刷新、权限不足等）
    
    6.  依赖关系
        
    
    *   `dependencies[]`：用 tool id 表达依赖（DAG）
        

> 你要的“自动判断”就是：运行时拿到 `PlatformInfo`，Catalog 里只挑匹配的 `assets`，版本列表来自 `versionSource`，不匹配就隐藏或灰掉。

* * *

3\. 安装引擎：统一流水线（决定你的可扩展性）
------------------------

把所有安装统一抽象成一个任务流水线：

**Resolve → Download → Verify → Install → Validate → Register**

### 你第一版需要支持的安装类型（Win+mac 都能覆盖）

*   **archive**：zip / tar.gz 解压到你的管理目录（最可控，跨平台一致）
    
*   **msi**（Windows）：静默安装（可选做）
    
*   **pkg**（macOS）：系统安装器（可选做）
    

建议策略（非常实用）：

*   MVP 优先用 archive 版（可装到你自己的管理目录，不污染系统）
    
*   需要系统级集成（比如驱动、证书、Xcode CLT）再引入 msi/pkg
    

### 安装目录策略（强烈建议）

*   Windows：`%LOCALAPPDATA%\<AppName>\tools\<toolId>\<version>\`
    
*   macOS：`~/Library/Application Support/<AppName>/tools/<toolId>/<version>/`
    

然后通过：

*   “shim”机制（你自己的 bin 目录）
    
*   或设置用户级 PATH（可选、要谨慎）  
    来让命令可用。
    

> 这样你能做“多版本共存”和“回滚”——对你这种工具来说是核心卖点。

* * *

4\. 环境扫描：Win+mac 的统一输出
----------------------

### Scanner 输出模型

每个工具输出一致结构：

*   `installed: boolean`
    
*   `version: string|null`
    
*   `path: string|null`
    
*   `source: system|managed|unknown`
    
*   `health: ok|warn|error`
    
*   `details: {…}`（例如检测到多个版本、冲突原因）
    

### 扫描策略优先级（跨平台一致）

1.  先看“managed 安装目录”是否有（你装过的）
    
2.  再看 PATH 探测（`which` / `where` + `tool -v`）
    
3.  再看系统信息来源：
    
    *   Windows：注册表 / 常见安装路径（后置）
        
    *   macOS：`/Applications`、`pkgutil`、`brew list`（后置）
        

MVP 不必把所有系统探测做完，先把“managed + PATH”跑通即可。

* * *

5\. 依赖系统：可解释的依赖图
----------------

实现一个小的依赖解析器：

*   输入：用户想装 `toolId@version`
    
*   输出：安装计划（拓扑排序）
    
*   UI 上显示：
    
    *   “将安装：A、B、C”
        
    *   “原因：C 依赖 B，B 依赖 A”
        

依赖类型建议支持：

*   `hard`：必须
    
*   `soft`：推荐（比如 Git 对一些工具是推荐项）
    
*   `platformOnly`：仅某 OS/arch（例如 WebView2 只在 Windows）
    

* * *

6\. “方案（Profiles）”：让它像“环境一键就绪”
------------------------------

方案就是一个 JSON：

*   目标工具列表 + 版本策略（固定版本 / 允许小版本更新 / 只要 LTS）
    
*   可选：环境变量策略（是否写 PATH）
    

功能：

*   创建方案（Web + Tauri / C++ Toolchain / Ainold Dev）
    
*   应用方案：对齐当前机器（缺啥装啥、版本不符提示升级/降级）
    
*   导入/导出：团队共享
    

* * *

7\. UI 信息架构（商店感 + 工程可读性）
------------------------

### 主要页面

1.  Dashboard：健康概览 + 一键应用方案 + 最近任务
    
2.  Catalog：商店列表（搜索/分类/标签/已安装状态）
    
3.  Tool Detail：版本选择（官方来源说明、适配的安装包、依赖树）
    
4.  Environment：体检（按工具链分类，支持展开详细路径/冲突）
    
5.  Tasks：任务队列（可取消、失败可复制诊断）
    
6.  Profiles：方案管理
    

UI 要点：

*   不用艺术字图标字体；图标用 SVG 资源或系统图标
    
*   所有动作都有日志与可解释原因（非常工程化）
    

* * *

8\. 安全与可信（双平台必须考虑）
------------------

MVP 就做这三条：

1.  下载来源白名单（官方域名 / 官方 GitHub Release / 你的镜像）
    
2.  sha256 校验（至少对 archive 做）
    
3.  Catalog 文件签名（防止被篡改为恶意下载地址）
    

权限：

*   默认不提权
    
*   需要提权的安装（msi/pkg）再触发 UAC/sudo，并明确原因
    

* * *

9\. 开发规划（Win+mac 同步推进）
----------------------

### Phase 0：基础工程骨架（1-2 周量级）

*   Electron + TS（主/渲染共享 types）
    
*   IPC 协议（scan/install/task/log）
    
*   任务队列框架（状态机 + 日志流）
    
*   UI 骨架：Catalog / Environment / Tasks
    

交付：可演示 UI + 假任务队列

* * *

### Phase 1：PlatformInfo + Catalog MVP（2-3 周）

*   自动识别 OS/arch（win/mac + x64/arm64）
    
*   解析 catalog 文件，按平台过滤可安装资产
    
*   版本源先实现 GitHub Releases（够用）
    
*   Tool Detail：版本列表 + 选择 + 生成安装计划（不真正安装）
    

交付：双平台都能看到“正确版本 + 正确包类型”

* * *

### Phase 2：Scanner MVP（2-3 周）

*   实现 6 个基础工具检测（建议）：
    
    *   Node
        
    *   Git
        
    *   CMake
        
    *   Python
        
    *   (mac) Xcode Command Line Tools（至少检测）
        
    *   (win) VS Build Tools / MSVC（至少检测）
        
*   输出统一 health 报告
    

交付：体检页真实可用（Win+mac）

* * *

### Phase 3：Installer Engine MVP（3-5 周）

*   实现 archive 安装（zip/tar.gz）全平台一致
    
*   下载进度、断点续传（可简化为可恢复下载）
    
*   sha256 校验
    
*   安装后 validate（命令检测版本）
    
*   register 到 managed DB
    

先闭环 3 个工具（全平台都能搞定）：

*   Node（优先用官方 archive 版）
    
*   CMake（可 archive）
    
*   Git（mac 可用 archive/或引导到系统安装，Windows 也可 archive）
    

交付：真正能“从商店安装并被体检识别”

* * *

### Phase 4：依赖图 + 方案（3-4 周）

*   依赖解析（拓扑排序）
    
*   方案：导入导出 + 一键对齐
    
*   任务并行与失败回滚（至少 archive 可回滚）
    

交付：一键准备 “Web+Tauri” 或 “C++ Toolchain” 的体验雏形

* * *

### Phase 5：系统级安装后端（长期）

*   Windows msi/exe silent
    
*   mac pkg 安装
    
*   提权流程与可审计日志
    
*   目录签名/远程更新
    
*   可选：winget/brew bridge（当作一个安装后端）
    

* * *

10\. 代码仓库结构建议（从 Day 1 就可扩展）
---------------------------

*   `apps/main/`：Electron main（安装、扫描、任务）
    
*   `apps/renderer/`：UI
    
*   `packages/shared/`：types、schema、通用工具
    
*   `packages/core/`：TaskEngine、Catalog、Resolver、Storage
    
*   `packages/adapters/`：win/mac 平台适配（scanner/installer/privilege）
    
*   `catalog/`：工具定义文件（yaml/json）
    
*   `schemas/`：JSON Schema（校验 catalog & profiles）
    
*   `tests/`：核心 resolver/task 的单测
    

* * *

11\. 你现在可以立刻开工的“第一批工具清单”（双平台友好）
-------------------------------

建议先把“能用 archive 安装并验证”的工具打通：

*   Node.js
    
*   CMake
    
*   Ninja
    
*   Git（如果 archive 麻烦，就先做“检测 + 引导到系统安装/或 brew/winget 后端”）
    
*   Python（同上：先检测，后置安装）
    

这样你不会卡在系统级安装器和权限复杂度上。

* * *

12\. 可执行落地包（目录结构 + Schema 初稿 + 12 周里程碑）
------------------------------------------

### A. 建议目录结构（Monorepo，按职责分层）

```text
AutoInstallManager/
  apps/
    main/                     # Electron Main（IPC、任务调度、安装编排）
      src/
        bootstrap/
        ipc/
        services/
    renderer/                 # Electron Renderer（UI）
      src/
        app/
        pages/
        components/
        stores/
  packages/
    core/                     # 纯业务核心（与 Electron 解耦）
      src/
        task-engine/
        resolver/
        installer-pipeline/
        scanner/
        profile/
    adapters/                 # 平台差异（win/mac）
      src/
        win/
        mac/
        shared/
    shared/                   # 类型、常量、错误码、IPC 协议定义
      src/
        types/
        contracts/
        errors/
        utils/
  catalog/                    # 工具定义（可扩展“上架”入口）
    nodejs.yaml
    git.yaml
    cmake.yaml
  schemas/                    # JSON Schema（catalog/profiles 校验）
    tool-definition.schema.json
    profile.schema.json
  tests/
    unit/
    integration/
    e2e/
  docs/
    ADR/
    roadmap/
```

### B. 模块边界规则（保证可维护）

* `apps/renderer` 只能通过 IPC 调用能力，不直接执行系统命令。
* `packages/core` 不依赖 Electron/Node GUI API，保证可单测与可迁移。
* `packages/adapters` 不写业务规则，只实现平台能力差异。
* `catalog/*.yaml` 只描述“是什么/怎么装/怎么验”，不塞业务逻辑代码。
* 所有跨模块通信统一走 `packages/shared/contracts`（含版本号）。

### C. ToolDefinition Schema 初稿

> 文件已落地：`schemas/tool-definition.schema.json`  
> 用于在 CI 与运行时校验 catalog 文件，防止字段漂移和脏数据。

最小定义（MVP）必须包含：

* `schemaVersion`
* `id`
* `name`
* `versionSource`
* `assets`
* `install`
* `validate`

### D. 12 周里程碑（可直接执行）

| 周次 | 目标 | 关键交付 |
|---|---|---|
| Week 1 | 架构冻结 | 分层依赖图、模块边界、IPC 合同草案、错误码规范 |
| Week 2 | 工程骨架 | `apps/packages/catalog/schemas/tests` 结构、基础构建与启动 |
| Week 3 | 合同与校验 | `shared contracts`、`tool-definition.schema.json`、catalog 校验 CLI |
| Week 4 | Catalog MVP | 解析 `catalog/*.yaml`、平台过滤（win/mac + x64/arm64） |
| Week 5 | Scanner MVP-1 | managed 目录检测 + PATH 检测（Node/Git/CMake/Python） |
| Week 6 | Scanner MVP-2 | 健康报告模型、冲突检测、多版本展示、导出 JSON |
| Week 7 | Installer MVP-1 | `resolve -> download -> verify`（含 hash 校验） |
| Week 8 | Installer MVP-2 | `install -> validate -> register`，支持 archive 安装 |
| Week 9 | 三工具闭环 | Node/Git/CMake 全链路安装 + 扫描识别 + 日志可追溯 |
| Week 10 | 依赖解析 | DAG 拓扑排序、可解释安装计划（why chain） |
| Week 11 | Profiles MVP | 方案导入导出、一键对齐（只装缺失/升级不符合） |
| Week 12 | 发布硬化 | CI 门禁、回归测试、签名与白名单策略、MVP 发布包 |

### E. 每周质量门禁（DoD）

* 新增能力必须附带：单测 + 文档 + 错误码。
* 不允许跨层直连依赖（CI 中做依赖检查）。
* Catalog 变更必须通过 schema 校验。
* 安装链路必须可观测：step 状态、日志、失败原因、可回滚结果。

* * *
