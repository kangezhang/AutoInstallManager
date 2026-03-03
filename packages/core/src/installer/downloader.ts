/**
 * Download Manager - 下载管理器
 * 负责文件下载、进度跟踪和校验
 */

import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import { dirname } from 'path';
import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import type {
  DownloadOptions,
  DownloadResult,
  DownloadProgress,
} from '@aim/shared';

/**
 * 下载文件
 */
export async function downloadFile(
  options: DownloadOptions
): Promise<DownloadResult> {
  const { url, destPath, sha256, headers, timeout = 300000, onProgress } = options;

  try {
    // 确保目标目录存在
    const dir = dirname(destPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // 发起下载请求
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    // 获取文件大小
    const total = parseInt(response.headers.get('content-length') || '0', 10);
    let downloaded = 0;
    let lastTime = Date.now();
    let lastDownloaded = 0;

    // 创建写入流
    const fileStream = createWriteStream(destPath);
    const hash = sha256 ? createHash('sha256') : null;

    // 处理响应流
    if (!response.body) {
      return {
        success: false,
        error: 'Response body is null',
      };
    }

    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        // 写入文件
        fileStream.write(value);

        // 更新哈希
        if (hash) {
          hash.update(value);
        }

        // 更新进度
        downloaded += value.length;
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000; // 秒

        if (elapsed >= 0.5 || downloaded === total) {
          // 每 0.5 秒更新一次
          const speed = (downloaded - lastDownloaded) / elapsed;
          const eta = speed > 0 ? (total - downloaded) / speed : 0;

          const progress: DownloadProgress = {
            total,
            downloaded,
            percent: total > 0 ? (downloaded / total) * 100 : 0,
            speed,
            eta,
          };

          onProgress?.(progress);

          lastTime = now;
          lastDownloaded = downloaded;
        }
      }

      // 关闭文件流
      fileStream.end();
      await new Promise<void>((resolve, reject) => {
        fileStream.on('finish', () => resolve());
        fileStream.on('error', reject);
      });

      // 校验 SHA256
      let verified = true;
      if (sha256 && hash) {
        const actualHash = hash.digest('hex');
        verified = actualHash.toLowerCase() === sha256.toLowerCase();

        if (!verified) {
          // 删除损坏的文件
          await unlink(destPath);
          return {
            success: false,
            error: `SHA256 mismatch: expected ${sha256}, got ${actualHash}`,
            verified: false,
          };
        }
      }

      return {
        success: true,
        filePath: destPath,
        verified,
      };
    } catch (error) {
      // 清理失败的下载
      fileStream.destroy();
      if (existsSync(destPath)) {
        await unlink(destPath);
      }
      throw error;
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 计算文件的 SHA256
 */
export async function calculateSHA256(filePath: string): Promise<string> {
  const { createReadStream } = await import('fs');
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);

  await pipeline(stream, hash);

  return hash.digest('hex');
}
