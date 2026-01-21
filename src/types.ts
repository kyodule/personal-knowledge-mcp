/**
 * 文档来源类型
 */
export type DocumentSource = 'local' | 'feishu' | 'wecom';

/**
 * 文档元数据
 */
export interface DocumentMetadata {
  author?: string;
  created_at?: string;
  updated_at?: string;
  url?: string;
  tags?: string[];
  file_path?: string;
  file_size?: number;
}

/**
 * 文档实体
 */
export interface Document {
  id: string;
  source: DocumentSource;
  source_id: string;
  title: string;
  content: string;
  metadata: DocumentMetadata;
  last_synced: string;
}

/**
 * 搜索过滤器
 */
export interface SearchFilters {
  source?: DocumentSource;
  tags?: string[];
  date_from?: string;
  date_to?: string;
}

/**
 * 飞书多维表格目标配置
 */
export interface BitableTarget {
  app_token: string;
  table_id: string;
}

/**
 * 飞书知识库目标配置
 */
export interface WikiTarget {
  space_id: string;
}

/**
 * 飞书云盘目标配置
 */
export interface DriveTarget {
  folder_token: string;
}

/**
 * 飞书默认目标配置
 */
export interface FeishuDefaultTargets {
  bitable?: Record<string, BitableTarget>;
  wiki?: Record<string, WikiTarget>;
  drive?: Record<string, DriveTarget>;
}

/**
 * 飞书配置
 */
export interface FeishuConfig {
  enabled: boolean;
  app_id: string;
  app_secret: string;
  default_targets?: FeishuDefaultTargets;
}

/**
 * 配置文件结构
 */
export interface Config {
  local: {
    enabled: boolean;
    watch_paths: string[];
    file_extensions: string[];
    exclude_patterns: string[];
  };
  feishu: FeishuConfig;
  wecom: {
    enabled: boolean;
    corp_id: string;
    secret: string;
  };
  database: {
    path: string;
  };
}

/**
 * 多维表格记录查询参数
 */
export interface GetBitableRecordsInput {
  app_token: string;
  table_id: string;
  view_id?: string;
  filter?: string;
  field_names?: string[];
  sort?: string;
  page_size?: number;
}

/**
 * 知识空间节点查询参数
 */
export interface GetWikiNodesInput {
  space_id: string;
  parent_node_token?: string;
}

/**
 * 知识库节点内容获取参数
 */
export interface GetWikiNodeContentInput {
  space_id: string;
  node_token: string;
}

/**
 * 云盘文件列表查询参数
 */
export interface ListDriveFilesInput {
  folder_token: string;
  file_type?: string;
  page_size?: number;
}

/**
 * 云盘文件内容获取参数
 */
export interface GetDriveFileContentInput {
  file_token: string;
  file_type: string;
}
