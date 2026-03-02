/**
 * Event Definitions
 */

export interface TaskProgressEvent {
  taskId: string;
  progress: number; // 0-1
  currentStep: string;
  message?: string;
}

export interface TaskLogEvent {
  taskId: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
}

export interface ScanCompleteEvent {
  success: boolean;
  toolsScanned: number;
  errors?: string[];
}
