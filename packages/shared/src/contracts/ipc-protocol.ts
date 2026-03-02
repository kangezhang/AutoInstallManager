/**
 * IPC Protocol Definition
 * Version: 1.0.0
 *
 * 所有主进程与渲染进程通信必须遵循此协议
 */

export const IPC_CHANNELS = {
  // Platform
  PLATFORM_GET_INFO: 'platform:getInfo',

  // Catalog
  CATALOG_LOAD: 'catalog:load',
  CATALOG_GET_TOOL: 'catalog:getTool',
  CATALOG_LIST_TOOLS: 'catalog:listTools',
  CATALOG_GET_VERSIONS: 'catalog:getVersions',

  // Scanner
  SCAN_START: 'scan:start',
  SCAN_TOOL: 'scan:tool',
  SCAN_GET_REPORT: 'scan:getReport',

  // Task
  TASK_CREATE: 'task:create',
  TASK_START: 'task:start',
  TASK_CANCEL: 'task:cancel',
  TASK_GET_STATUS: 'task:getStatus',
  TASK_LIST: 'task:list',

  // Events (Main -> Renderer)
  EVENT_TASK_PROGRESS: 'event:taskProgress',
  EVENT_TASK_LOG: 'event:taskLog',
  EVENT_SCAN_COMPLETE: 'event:scanComplete',
} as const;

export type IPCChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS];

// Request/Response 类型
export interface IPCRequest<T = unknown> {
  id: string;
  channel: IPCChannel;
  payload: T;
  timestamp: number;
}

export interface IPCResponse<T = unknown> {
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

// Event 类型
export interface IPCEvent<T = unknown> {
  channel: IPCChannel;
  payload: T;
  timestamp: number;
}
