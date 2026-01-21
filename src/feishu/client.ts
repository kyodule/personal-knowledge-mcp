import * as lark from '@larksuiteoapi/node-sdk';
import { FeishuConfig } from '../types.js';

let clientInstance: lark.Client | null = null;

/**
 * 获取飞书客户端实例（单例模式）
 */
export function getFeishuClient(config: FeishuConfig): lark.Client {
  if (!clientInstance) {
    if (!config.app_id || !config.app_secret) {
      throw new Error('飞书配置缺少 app_id 或 app_secret');
    }

    clientInstance = new lark.Client({
      appId: config.app_id,
      appSecret: config.app_secret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.Feishu,
    });
  }

  return clientInstance;
}

/**
 * 重置客户端实例（用于配置变更时）
 */
export function resetFeishuClient(): void {
  clientInstance = null;
}
