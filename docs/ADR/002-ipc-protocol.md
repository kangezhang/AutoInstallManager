# ADR 002: IPC 协议设计

## 状态

已接受

## 背景

Electron 应用的主进程和渲染进程需要通过 IPC（Inter-Process Communication）进行通信。需要设计一个：

1. 类型安全的 IPC 协议
2. 支持 Request/Response 和 Event 两种模式
3. 统一的错误处理
4. 易于扩展和维护

## 决策

采用 **electron-trpc** 实现类型安全的 IPC 通信，并定义统一的协议规范。

### IPC 通道命名规范

格式：`<模块>:<操作>`

示例：
- `platform:getInfo` - 获取平台信息
- `catalog:listTools` - 列出工具
- `task:create` - 创建任务
- `event:taskProgress` - 任务进度事件

### 通道分类

1. **Platform**：平台相关
   - `platform:getInfo`

2. **Catalog**：工具目录
   - `catalog:load`
   - `catalog:getTool`
   - `catalog:listTools`
   - `catalog:getVersions`

3. **Scanner**：环境扫描
   - `scan:start`
   - `scan:tool`
   - `scan:getReport`

4. **Task**：任务管理
   - `task:create`
   - `task:start`
   - `task:cancel`
   - `task:getStatus`
   - `task:list`

5. **Events**：事件通知（Main -> Renderer）
   - `event:taskProgress`
   - `event:taskLog`
   - `event:scanComplete`

### 数据结构

#### Request
```typescript
interface IPCRequest<T = unknown> {
  id: string;
  channel: IPCChannel;
  payload: T;
  timestamp: number;
}
```

#### Response
```typescript
interface IPCResponse<T = unknown> {
  id: string;
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: number;
}
```

#### Event
```typescript
interface IPCEvent<T = unknown> {
  channel: IPCChannel;
  payload: T;
  timestamp: number;
}
```

### 错误处理

使用统一的错误码系统（见 `error-codes.ts`）：

```typescript
{
  code: 'CATALOG_TOOL_NOT_FOUND',
  message: 'Tool not found: nodejs',
  details: { toolId: 'nodejs' }
}
```

## 优势

1. **类型安全**：TypeScript 编译时检查，避免类型错误
2. **统一规范**：所有 IPC 通信遵循相同的模式
3. **易于调试**：每个请求有唯一 ID 和时间戳
4. **错误可追溯**：统一的错误码和详细信息
5. **自动补全**：IDE 可以提供完整的类型提示

## 劣势

1. **学习成本**：需要学习 tRPC 的使用
2. **依赖额外库**：增加了 electron-trpc 依赖
3. **性能开销**：类型检查和序列化有轻微性能开销

## 替代方案

### 方案 A：原生 ipcMain/ipcRenderer
使用 Electron 原生 IPC API。

**拒绝理由**：
- 无类型安全
- 需要手动处理序列化和错误
- 代码重复多

### 方案 B：自定义 IPC 封装
自己封装一套类型安全的 IPC 层。

**拒绝理由**：
- 开发成本高
- 需要维护额外代码
- electron-trpc 已经是成熟方案

## 实施

1. 定义 IPC 通道常量（`ipc-protocol.ts`）
2. 定义错误码系统（`error-codes.ts`）
3. 在主进程创建 tRPC 路由
4. 在渲染进程创建 tRPC 客户端
5. 为每个模块创建独立的 procedure

## 参考

- [electron-trpc](https://github.com/jsonnull/electron-trpc)
- [tRPC Documentation](https://trpc.io/)
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
