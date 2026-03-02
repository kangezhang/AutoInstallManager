/**
 * Platform Type Definitions
 */

export type OS = 'win' | 'mac';
export type Arch = 'x64' | 'arm64';

export interface PlatformInfo {
  os: OS;
  arch: Arch;
  version: string; // OS 版本
  isAdmin: boolean; // 是否管理员权限
  paths: {
    home: string;
    appData: string;
    temp: string;
    managed: string; // 工具管理目录
  };
}

export interface PlatformCapabilities {
  canInstallMSI: boolean;
  canInstallPKG: boolean;
  canInstallArchive: boolean;
  canElevatePrivilege: boolean;
}
