/**
 * Legacy ambient declaration — kept so existing pages that read
 * `window.electronAPI.foo.bar()` still type-check after the Tauri migration.
 *
 * The actual implementation now lives in `services/tauri-api.ts`, which
 * installs an object with the same shape as the old preload contract.
 * Pages aren't yet rewritten to call `invoke()` directly; this `any`-typed
 * shim keeps the migration incremental.
 */

export {};

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    electronAPI: any;
  }
}
