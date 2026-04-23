import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import * as lark from '@larksuiteoapi/node-sdk';
import { KnowledgeDatabase } from './storage/database.js';
import { LocalCrawler } from './crawlers/local-crawler.js';
import { lintDuplicates } from './retrieval/lint.js';
import { Config, SearchFilters, SearchResult } from './types.js';
import {
  getFeishuClient,
  resetFeishuClient,
  getBitableRecords,
  listBitableTables,
  createBitableRecords,
  updateBitableRecord,
  batchUpdateBitableRecords,
  deleteBitableRecords,
  listBitableFields,
  createBitableField,
  updateBitableField,
  deleteBitableField,
  getWikiNodes,
  getWikiNodeContent,
  listWikiSpaces,
  extractDocxContent,
  writeDocxContent,
  listDriveFiles,
  getDriveFileContent,
  listSheets,
  getSheetData,
  getSpreadsheetContent,
  writeSheetData,
  appendSheetData,
} from './feishu/index.js';

/**
 * 个人知识库 MCP Server
 */
export class KnowledgeMCPServer {
  private server: Server;
  private database: KnowledgeDatabase;
  private localCrawler?: LocalCrawler;
  private feishuClient?: lark.Client;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.database = new KnowledgeDatabase(config.database.path);

    // 初始化本地爬虫
    if (config.local.enabled) {
      this.localCrawler = new LocalCrawler(
        this.database,
        config.local.watch_paths,
        config.local.file_extensions,
        config.local.exclude_patterns
      );
    }

    // 初始化飞书客户端
    if (config.feishu.enabled && config.feishu.app_id && config.feishu.app_secret) {
      this.feishuClient = getFeishuClient(config.feishu);
    }

    // 创建 MCP Server
    this.server = new Server(
      {
        name: 'personal-knowledge-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * 设置 MCP 请求处理器
   */
  private setupHandlers(): void {
    // 列出可用工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        {
          name: 'search_documents',
          description: '搜索知识库中的文档。支持全文搜索，可按来源筛选。',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '搜索关键词（支持多个词，用空格分隔）',
              },
              source: {
                type: 'string',
                enum: ['local', 'feishu', 'wecom'],
                description: '限定文档来源（可选）',
              },
              limit: {
                type: 'number',
                description: '返回结果数量，默认 20',
                default: 20,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_document',
          description: '获取完整的文档内容',
          inputSchema: {
            type: 'object',
            properties: {
              document_id: {
                type: 'string',
                description: '文档 ID',
              },
            },
            required: ['document_id'],
          },
        },
        {
          name: 'list_documents',
          description: '列出所有文档（按最近同步时间排序）',
          inputSchema: {
            type: 'object',
            properties: {
              source: {
                type: 'string',
                enum: ['local', 'feishu', 'wecom'],
                description: '限定文档来源（可选）',
              },
              limit: {
                type: 'number',
                description: '返回结果数量，默认 50',
                default: 50,
              },
            },
          },
        },
        {
          name: 'get_stats',
          description: '获取知识库统计信息（各来源的文档数量）',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'sync_local_documents',
          description: '手动触发本地文档同步（全量索引）',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'index_file',
          description: '索引单个本地文件（增量索引，比全量 sync 快得多）。文件必须在 config.json 的 watch_paths 范围内。',
          inputSchema: {
            type: 'object',
            properties: {
              file_path: {
                type: 'string',
                description: '要索引的文件绝对路径',
              },
              generate_embedding: {
                type: 'boolean',
                description: '是否同时生成 embedding（用于向量搜索），默认 true',
                default: true,
              },
            },
            required: ['file_path'],
          },
        },
        {
          name: 'lint_duplicates',
          description: '检测知识库中近似重复的文档（基于文档级 embedding 余弦相似度 + 标题 bigram Jaccard）。用于 wiki concepts/entities 去重。',
          inputSchema: {
            type: 'object',
            properties: {
              path_like: {
                type: 'string',
                description: 'source_id 的 LIKE 模式，如 "%/wiki/concepts/%" 或 "%/wiki/entities/%"',
              },
              threshold: {
                type: 'number',
                description: '语义相似度阈值（0-1），默认 0.85',
                default: 0.85,
              },
              limit: {
                type: 'number',
                description: '返回候选对的最大数量，默认 50',
                default: 50,
              },
              max_chars: {
                type: 'number',
                description: '文档级 embedding 截断字符数，默认 2000',
                default: 2000,
              },
            },
            required: ['path_like'],
          },
        },
      ];

      // 如果飞书已启用，添加飞书相关工具
      if (this.feishuClient) {
        tools.push(
          {
            name: 'get_bitable_records',
            description: '获取飞书多维表格记录，支持筛选、字段选择、排序',
            inputSchema: {
              type: 'object',
              properties: {
                app_token: {
                  type: 'string',
                  description: '多维表格的 app_token（从 URL 获取）',
                },
                table_id: {
                  type: 'string',
                  description: '数据表 ID',
                },
                view_id: {
                  type: 'string',
                  description: '视图 ID（可选，用于筛选特定视图的数据）',
                },
                filter: {
                  type: 'string',
                  description: '筛选公式，如 "CurrentValue.[日期] >= DATEADD(TODAY(), -2, \\"day\\")"',
                },
                field_names: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '只返回指定字段，如 ["任务名称", "负责人", "风险点"]',
                },
                sort: {
                  type: 'string',
                  description: '排序规则，如 "[日期] DESC"',
                },
                page_size: {
                  type: 'number',
                  description: '每页记录数，默认 100',
                  default: 100,
                },
              },
              required: ['app_token', 'table_id'],
            },
          },
          {
            name: 'list_bitable_tables',
            description: '列出飞书多维表格中的所有数据表',
            inputSchema: {
              type: 'object',
              properties: {
                app_token: {
                  type: 'string',
                  description: '多维表格的 app_token',
                },
              },
              required: ['app_token'],
            },
          },
          {
            name: 'list_wiki_spaces',
            description: '列出当前应用可访问的所有飞书知识空间。用于发现可用的知识空间及其 space_id',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'get_wiki_nodes',
            description: '获取飞书知识空间的节点列表（文档目录）。支持 recursive 参数递归获取所有子节点。注意：需要 space_id（数字格式，如 7561364012530434051），不是 node_token',
            inputSchema: {
              type: 'object',
              properties: {
                space_id: {
                  type: 'string',
                  description: '知识空间 ID（数字格式，如 7561364012530434051）',
                },
                parent_node_token: {
                  type: 'string',
                  description: '父节点 token（可选，不传则返回根节点的直接子节点）',
                },
                recursive: {
                  type: 'boolean',
                  description: '是否递归获取所有子节点（默认 false，只返回一层）',
                },
              },
              required: ['space_id'],
            },
          },
          {
            name: 'get_wiki_node_content',
            description: '获取飞书知识库中指定文档的内容。只需 node_token（从 wiki URL 中 /wiki/ 后的部分），无需 space_id。返回值包含 space_id 和 has_child，可直接用于后续调用 get_wiki_nodes 展开目录树',
            inputSchema: {
              type: 'object',
              properties: {
                node_token: {
                  type: 'string',
                  description: '节点 token（从 wiki URL 获取，如 https://xxx.feishu.cn/wiki/CwrFwxs7jigxPYkVHWHc1wb6nPh 中的 CwrFwxs7jigxPYkVHWHc1wb6nPh）',
                },
              },
              required: ['node_token'],
            },
          },
          {
            name: 'get_docx_content',
            description: '获取飞书云文档的纯文本内容',
            inputSchema: {
              type: 'object',
              properties: {
                document_id: {
                  type: 'string',
                  description: '云文档 ID（从 URL 获取）',
                },
              },
              required: ['document_id'],
            },
          },
          {
            name: 'write_docx_content',
            description: '向飞书云文档写入 Markdown 内容。将 Markdown 解析为飞书文档块（标题、列表、代码块、引用等），追加到文档末尾。适用于向已有文档批量写入结构化内容',
            inputSchema: {
              type: 'object',
              properties: {
                document_id: {
                  type: 'string',
                  description: '云文档 ID（从 URL 获取，如 https://xxx.feishu.cn/docx/OdETduLUeofcxVxjOIxc52T7nLc 中的 OdETduLUeofcxVxjOIxc52T7nLc）',
                },
                content: {
                  type: 'string',
                  description: '要写入的 Markdown 内容，支持标题(#)、列表(-)、代码块(```)、引用(>)、加粗(**)等格式',
                },
              },
              required: ['document_id', 'content'],
            },
          },
          {
            name: 'list_drive_files',
            description: '列出飞书云盘文件夹中的文件。需要先将文件夹共享给应用，然后传入该文件夹的 token',
            inputSchema: {
              type: 'object',
              properties: {
                folder_token: {
                  type: 'string',
                  description: '文件夹 token（需要先在飞书中将文件夹共享给应用）',
                },
                file_type: {
                  type: 'string',
                  enum: ['doc', 'docx', 'sheet', 'bitable', 'folder'],
                  description: '筛选文件类型（可选）',
                },
                page_size: {
                  type: 'number',
                  description: '每页数量，默认 50',
                  default: 50,
                },
              },
              required: ['folder_token'],
            },
          },
          {
            name: 'get_drive_file_content',
            description: '获取飞书云盘中指定文件的内容',
            inputSchema: {
              type: 'object',
              properties: {
                file_token: {
                  type: 'string',
                  description: '文件 token',
                },
                file_type: {
                  type: 'string',
                  enum: ['docx', 'doc', 'sheet'],
                  description: '文件类型',
                },
              },
              required: ['file_token', 'file_type'],
            },
          },
          {
            name: 'get_sheet_data',
            description: '获取飞书电子表格数据。支持读取指定工作表和范围的数据。',
            inputSchema: {
              type: 'object',
              properties: {
                spreadsheet_token: {
                  type: 'string',
                  description: '电子表格 token（从 URL 获取，如 https://xxx.feishu.cn/sheets/shtcnXXXX 中的 shtcnXXXX）',
                },
                sheet_id: {
                  type: 'string',
                  description: '工作表 ID（可选，不指定则读取第一个工作表）',
                },
                range: {
                  type: 'string',
                  description: '单元格范围（可选，如 A1:Z100，不指定则读取整个工作表）',
                },
              },
              required: ['spreadsheet_token'],
            },
          },
          {
            name: 'list_sheets',
            description: '列出飞书电子表格中的所有工作表',
            inputSchema: {
              type: 'object',
              properties: {
                spreadsheet_token: {
                  type: 'string',
                  description: '电子表格 token（从 URL 获取）',
                },
              },
              required: ['spreadsheet_token'],
            },
          },
          {
            name: 'write_sheet_data',
            description: '写入飞书电子表格指定范围的数据（覆盖写入）',
            inputSchema: {
              type: 'object',
              properties: {
                spreadsheet_token: {
                  type: 'string',
                  description: '电子表格 token（从 URL 获取）',
                },
                sheet_id: {
                  type: 'string',
                  description: '工作表 ID（可选，不指定则写入第一个工作表）',
                },
                range: {
                  type: 'string',
                  description: '写入范围，如 A1:C3',
                },
                values: {
                  type: 'array',
                  description: '二维数组，每个子数组代表一行数据',
                  items: {
                    type: 'array',
                    items: {},
                  },
                },
              },
              required: ['spreadsheet_token', 'range', 'values'],
            },
          },
          {
            name: 'append_sheet_data',
            description: '追加数据到飞书电子表格（在已有数据后追加新行）',
            inputSchema: {
              type: 'object',
              properties: {
                spreadsheet_token: {
                  type: 'string',
                  description: '电子表格 token（从 URL 获取）',
                },
                sheet_id: {
                  type: 'string',
                  description: '工作表 ID（可选，不指定则追加到第一个工作表）',
                },
                values: {
                  type: 'array',
                  description: '二维数组，每个子数组代表一行数据',
                  items: {
                    type: 'array',
                    items: {},
                  },
                },
              },
              required: ['spreadsheet_token', 'values'],
            },
          },
          {
            name: 'create_bitable_records',
            description: '创建飞书多维表格记录（支持批量创建）',
            inputSchema: {
              type: 'object',
              properties: {
                app_token: {
                  type: 'string',
                  description: '多维表格的 app_token（从 URL 获取）',
                },
                table_id: {
                  type: 'string',
                  description: '数据表 ID',
                },
                records: {
                  type: 'array',
                  description: '要创建的记录数组，每条记录包含 fields 字段映射',
                  items: {
                    type: 'object',
                    properties: {
                      fields: {
                        type: 'object',
                        description: '字段名到值的映射',
                      },
                    },
                    required: ['fields'],
                  },
                },
              },
              required: ['app_token', 'table_id', 'records'],
            },
          },
          {
            name: 'update_bitable_record',
            description: '更新飞书多维表格中的单条记录',
            inputSchema: {
              type: 'object',
              properties: {
                app_token: {
                  type: 'string',
                  description: '多维表格的 app_token',
                },
                table_id: {
                  type: 'string',
                  description: '数据表 ID',
                },
                record_id: {
                  type: 'string',
                  description: '要更新的记录 ID',
                },
                fields: {
                  type: 'object',
                  description: '要更新的字段名到值的映射',
                },
              },
              required: ['app_token', 'table_id', 'record_id', 'fields'],
            },
          },
          {
            name: 'batch_update_bitable_records',
            description: '批量更新飞书多维表格记录',
            inputSchema: {
              type: 'object',
              properties: {
                app_token: {
                  type: 'string',
                  description: '多维表格的 app_token',
                },
                table_id: {
                  type: 'string',
                  description: '数据表 ID',
                },
                records: {
                  type: 'array',
                  description: '要更新的记录数组',
                  items: {
                    type: 'object',
                    properties: {
                      record_id: {
                        type: 'string',
                        description: '记录 ID',
                      },
                      fields: {
                        type: 'object',
                        description: '要更新的字段',
                      },
                    },
                    required: ['record_id', 'fields'],
                  },
                },
              },
              required: ['app_token', 'table_id', 'records'],
            },
          },
          {
            name: 'delete_bitable_records',
            description: '删除飞书多维表格记录（支持批量删除）',
            inputSchema: {
              type: 'object',
              properties: {
                app_token: {
                  type: 'string',
                  description: '多维表格的 app_token',
                },
                table_id: {
                  type: 'string',
                  description: '数据表 ID',
                },
                record_ids: {
                  type: 'array',
                  description: '要删除的记录 ID 数组',
                  items: {
                    type: 'string',
                  },
                },
              },
              required: ['app_token', 'table_id', 'record_ids'],
            },
          },
          {
            name: 'list_bitable_fields',
            description: '列出飞书多维表格的所有字段（列）定义，返回字段 ID、名称、类型等信息',
            inputSchema: {
              type: 'object',
              properties: {
                app_token: {
                  type: 'string',
                  description: '多维表格的 app_token',
                },
                table_id: {
                  type: 'string',
                  description: '数据表 ID',
                },
              },
              required: ['app_token', 'table_id'],
            },
          },
          {
            name: 'create_bitable_field',
            description: '在飞书多维表格中创建新字段（列）。常用 type：1=文本, 3=单选, 5=日期, 15=URL',
            inputSchema: {
              type: 'object',
              properties: {
                app_token: {
                  type: 'string',
                  description: '多维表格的 app_token',
                },
                table_id: {
                  type: 'string',
                  description: '数据表 ID',
                },
                field_name: {
                  type: 'string',
                  description: '字段名称',
                },
                type: {
                  type: 'number',
                  description: '字段类型：1=文本, 2=数字, 3=单选, 4=多选, 5=日期, 7=复选框, 15=URL',
                },
                description: {
                  type: 'string',
                  description: '字段描述（可选）',
                },
                property: {
                  type: 'object',
                  description: '字段属性（可选），如单选的 options: [{name: "选项1"}, {name: "选项2"}]',
                },
              },
              required: ['app_token', 'table_id', 'field_name', 'type'],
            },
          },
          {
            name: 'update_bitable_field',
            description: '更新飞书多维表格字段（重命名、修改属性等）',
            inputSchema: {
              type: 'object',
              properties: {
                app_token: {
                  type: 'string',
                  description: '多维表格的 app_token',
                },
                table_id: {
                  type: 'string',
                  description: '数据表 ID',
                },
                field_id: {
                  type: 'string',
                  description: '要更新的字段 ID',
                },
                field_name: {
                  type: 'string',
                  description: '新的字段名称（可选）',
                },
                type: {
                  type: 'number',
                  description: '新的字段类型（可选）',
                },
                description: {
                  type: 'string',
                  description: '新的字段描述（可选）',
                },
                property: {
                  type: 'object',
                  description: '新的字段属性（可选）',
                },
              },
              required: ['app_token', 'table_id', 'field_id'],
            },
          },
          {
            name: 'delete_bitable_field',
            description: '删除飞书多维表格中的字段（列）',
            inputSchema: {
              type: 'object',
              properties: {
                app_token: {
                  type: 'string',
                  description: '多维表格的 app_token',
                },
                table_id: {
                  type: 'string',
                  description: '数据表 ID',
                },
                field_id: {
                  type: 'string',
                  description: '要删除的字段 ID',
                },
              },
              required: ['app_token', 'table_id', 'field_id'],
            },
          }
        );
      }

      return { tools };
    });

    // 处理工具调用
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'search_documents':
            return await this.handleSearch(args);

          case 'get_document':
            return await this.handleGetDocument(args);

          case 'list_documents':
            return await this.handleListDocuments(args);

          case 'get_stats':
            return await this.handleGetStats();

          case 'sync_local_documents':
            return await this.handleSyncLocal();

          case 'index_file':
            return await this.handleIndexFile(args);

          case 'lint_duplicates':
            return await this.handleLintDuplicates(args);

          // 飞书相关工具（统一 retry 包装）
          case 'get_bitable_records':
            return await this.withFeishuRetry(() => this.handleGetBitableRecords(args));

          case 'list_bitable_tables':
            return await this.withFeishuRetry(() => this.handleListBitableTables(args));

          case 'get_wiki_nodes':
            return await this.withFeishuRetry(() => this.handleGetWikiNodes(args));

          case 'get_wiki_node_content':
            return await this.withFeishuRetry(() => this.handleGetWikiNodeContent(args));

          case 'list_wiki_spaces':
            return await this.withFeishuRetry(() => this.handleListWikiSpaces());

          case 'get_docx_content':
            return await this.withFeishuRetry(() => this.handleGetDocxContent(args));

          case 'write_docx_content':
            return await this.withFeishuRetry(() => this.handleWriteDocxContent(args));

          case 'list_drive_files':
            return await this.withFeishuRetry(() => this.handleListDriveFiles(args));

          case 'get_drive_file_content':
            return await this.withFeishuRetry(() => this.handleGetDriveFileContent(args));

          case 'get_sheet_data':
            return await this.withFeishuRetry(() => this.handleGetSheetData(args));

          case 'list_sheets':
            return await this.withFeishuRetry(() => this.handleListSheets(args));

          // 写入工具
          case 'write_sheet_data':
            return await this.withFeishuRetry(() => this.handleWriteSheetData(args));

          case 'append_sheet_data':
            return await this.withFeishuRetry(() => this.handleAppendSheetData(args));

          case 'create_bitable_records':
            return await this.withFeishuRetry(() => this.handleCreateBitableRecords(args));

          case 'update_bitable_record':
            return await this.withFeishuRetry(() => this.handleUpdateBitableRecord(args));

          case 'batch_update_bitable_records':
            return await this.withFeishuRetry(() => this.handleBatchUpdateBitableRecords(args));

          case 'delete_bitable_records':
            return await this.withFeishuRetry(() => this.handleDeleteBitableRecords(args));

          case 'list_bitable_fields':
            return await this.withFeishuRetry(() => this.handleListBitableFields(args));

          case 'create_bitable_field':
            return await this.withFeishuRetry(() => this.handleCreateBitableField(args));

          case 'update_bitable_field':
            return await this.withFeishuRetry(() => this.handleUpdateBitableField(args));

          case 'delete_bitable_field':
            return await this.withFeishuRetry(() => this.handleDeleteBitableField(args));

          default:
            throw new Error(`未知工具: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `错误: ${error}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * 处理搜索请求
   */
  private async handleSearch(args: any) {
    const { query, source, limit = 20 } = args;

    if (!query || typeof query !== 'string') {
      throw new Error('query 参数必须是非空字符串');
    }

    const filters: SearchFilters | undefined = source ? { source } : undefined;

    // Generate query embedding for hybrid search
    let queryEmbedding: Buffer | undefined;
    try {
      const { embed, vecToBuffer } = await import('./utils/embedder.js');
      const vec = await embed(query);
      queryEmbedding = vecToBuffer(vec);
    } catch { /* fallback to BM25 only */ }

    const results: SearchResult[] = this.database.searchDocuments(query, filters, limit, queryEmbedding);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              total: results.length,
              documents: results.map((r) => ({
                id: r.id,
                title: r.title,
                source: r.source,
                snippet: r.snippet,
                chunk_index: r.chunk_index,
                metadata: r.metadata,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * 处理获取文档请求
   */
  private async handleGetDocument(args: any) {
    const { document_id } = args;

    if (!document_id || typeof document_id !== 'string') {
      throw new Error('document_id 参数必须是非空字符串');
    }

    const doc = this.database.getDocument(document_id);

    if (!doc) {
      throw new Error(`文档不存在: ${document_id}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(doc, null, 2),
        },
      ],
    };
  }

  /**
   * 处理列出文档请求
   */
  private async handleListDocuments(args: any) {
    const { source, limit = 50 } = args;

    const documents = this.database.getAllDocuments(source, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              total: documents.length,
              documents: documents.map((doc) => ({
                id: doc.id,
                title: doc.title,
                source: doc.source,
                last_synced: doc.metadata.updated_at || doc.last_synced,
              })),
            },
            null,
            2
          ),
        },
      ],
    };
  }

  /**
   * 处理获取统计信息请求
   */
  private async handleGetStats() {
    const stats = this.database.getStats();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ stats }, null, 2),
        },
      ],
    };
  }

  /**
   * 处理本地文档同步请求
   */
  private async handleSyncLocal() {
    if (!this.localCrawler) {
      throw new Error('本地文档爬虫未启用');
    }

    const count = await this.localCrawler.indexAll();

    return {
      content: [
        {
          type: 'text',
          text: `本地文档同步完成，共索引 ${count} 个文档`,
        },
      ],
    };
  }

  /**
   * 处理单文件索引请求
   */
  private async handleIndexFile(args: any) {
    if (!this.localCrawler) {
      throw new Error('本地文档爬虫未启用');
    }

    const { file_path, generate_embedding = true } = args;
    if (!file_path || typeof file_path !== 'string') {
      throw new Error('file_path 参数必须是非空字符串');
    }

    const result = await this.localCrawler.indexFile(file_path, generate_embedding);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: `文件索引完成`,
            id: result.id,
            title: result.title,
            chunks: result.chunks,
          }, null, 2),
        },
      ],
    };
  }

  /**
   * 处理近似重复检测请求 (P0-3)
   */
  private async handleLintDuplicates(args: any) {
    const { path_like, threshold, limit, max_chars } = args || {};
    if (!path_like || typeof path_like !== 'string') {
      throw new Error('path_like 参数必须是非空字符串，例如 "%/wiki/concepts/%"');
    }
    const result = await lintDuplicates(this.database, {
      pathLike: path_like,
      threshold,
      limit,
      maxChars: max_chars,
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  // ==================== 飞书相关处理方法 ====================

  /**
   * 确保飞书客户端可用
   */
  private ensureFeishuClient(): lark.Client {
    if (!this.feishuClient) {
      throw new Error('飞书功能未启用，请在 config.json 中配置 feishu.enabled: true 并提供 app_id 和 app_secret');
    }
    return this.feishuClient;
  }

  /**
   * 包装飞书 API 调用，添加 retry 和友好错误提示
   */
  private async withFeishuRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        const msg = error?.message || String(error);
        if (msg.includes('tenant_access_token') && msg.includes('undefined')) {
          if (attempt < maxRetries) {
            // 重置客户端实例，强制重新获取 token
            resetFeishuClient();
            this.feishuClient = getFeishuClient(this.config.feishu);
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          throw new Error(
            '飞书认证失败：无法获取 tenant_access_token。' +
            '这通常是网络问题（超时/DNS/代理）导致的，SDK 内部吞掉了原始错误。' +
            '请检查网络连接后重试。'
          );
        }
        throw error;
      }
    }
    throw new Error('飞书 API 调用失败：已达最大重试次数');
  }

  /**
   * 处理获取多维表格记录
   */
  private async handleGetBitableRecords(args: any) {
    const client = this.ensureFeishuClient();
    const { app_token, table_id, view_id, filter, field_names, sort, page_size } = args;

    if (!app_token || !table_id) {
      throw new Error('app_token 和 table_id 参数必须提供');
    }

    const result = await getBitableRecords(client, {
      app_token,
      table_id,
      view_id,
      filter,
      field_names,
      sort,
      page_size,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理列出多维表格数据表
   */
  private async handleListBitableTables(args: any) {
    const client = this.ensureFeishuClient();
    const { app_token } = args;

    if (!app_token) {
      throw new Error('app_token 参数必须提供');
    }

    const tables = await listBitableTables(client, app_token);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ tables }, null, 2),
        },
      ],
    };
  }

  /**
   * 处理获取知识空间节点
   */
  private async handleGetWikiNodes(args: any) {
    const client = this.ensureFeishuClient();
    const { space_id, parent_node_token, recursive } = args;

    if (!space_id) {
      throw new Error('space_id 参数必须提供');
    }

    const result = await getWikiNodes(client, { space_id, parent_node_token, recursive });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理获取知识库节点内容
   */
  private async handleGetWikiNodeContent(args: any) {
    const client = this.ensureFeishuClient();
    const { node_token } = args;

    if (!node_token) {
      throw new Error('node_token 参数必须提供');
    }

    const result = await getWikiNodeContent(client, { node_token });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理列出知识空间
   */
  private async handleListWikiSpaces() {
    const client = this.ensureFeishuClient();
    const result = await listWikiSpaces(client);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理获取云文档内容
   */
  private async handleGetDocxContent(args: any) {
    const client = this.ensureFeishuClient();
    const { document_id } = args;

    if (!document_id) {
      throw new Error('document_id 参数必须提供');
    }

    const content = await extractDocxContent(client, document_id);

    return {
      content: [
        {
          type: 'text',
          text: content,
        },
      ],
    };
  }

  /**
   * 处理写入云文档内容
   */
  private async handleWriteDocxContent(args: any) {
    const client = this.ensureFeishuClient();
    const { document_id, content } = args;

    if (!document_id) {
      throw new Error('document_id 参数必须提供');
    }
    if (!content) {
      throw new Error('content 参数必须提供');
    }

    const result = await writeDocxContent(client, document_id, content);

    return {
      content: [
        {
          type: 'text',
          text: `写入成功，共创建 ${result.blocksCreated} 个文档块`,
        },
      ],
    };
  }

  /**
   * 处理列出云盘文件
   */
  private async handleListDriveFiles(args: any) {
    const client = this.ensureFeishuClient();
    const { folder_token, file_type, page_size } = args;

    if (!folder_token) {
      throw new Error('folder_token 参数必须提供');
    }

    const result = await listDriveFiles(client, { folder_token, file_type, page_size });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理获取云盘文件内容
   */
  private async handleGetDriveFileContent(args: any) {
    const client = this.ensureFeishuClient();
    const { file_token, file_type } = args;

    if (!file_token || !file_type) {
      throw new Error('file_token 和 file_type 参数必须提供');
    }

    const result = await getDriveFileContent(client, { file_token, file_type });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理获取电子表格数据
   */
  private async handleGetSheetData(args: any) {
    const client = this.ensureFeishuClient();
    const { spreadsheet_token, sheet_id, range } = args;

    if (!spreadsheet_token) {
      throw new Error('spreadsheet_token 参数必须提供');
    }

    const result = await getSheetData(client, { spreadsheet_token, sheet_id, range });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理列出工作表
   */
  private async handleListSheets(args: any) {
    const client = this.ensureFeishuClient();
    const { spreadsheet_token } = args;

    if (!spreadsheet_token) {
      throw new Error('spreadsheet_token 参数必须提供');
    }

    const sheets = await listSheets(client, spreadsheet_token);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ sheets }, null, 2),
        },
      ],
    };
  }

  /**
   * 处理写入电子表格数据
   */
  private async handleWriteSheetData(args: any) {
    const client = this.ensureFeishuClient();
    const { spreadsheet_token, sheet_id, range, values } = args;

    if (!spreadsheet_token || !range || !values) {
      throw new Error('spreadsheet_token、range 和 values 参数必须提供');
    }

    const result = await writeSheetData(client, { spreadsheet_token, sheet_id, range, values });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理追加电子表格数据
   */
  private async handleAppendSheetData(args: any) {
    const client = this.ensureFeishuClient();
    const { spreadsheet_token, sheet_id, values } = args;

    if (!spreadsheet_token || !values) {
      throw new Error('spreadsheet_token 和 values 参数必须提供');
    }

    const result = await appendSheetData(client, { spreadsheet_token, sheet_id, values });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理创建多维表格记录
   */
  private async handleCreateBitableRecords(args: any) {
    const client = this.ensureFeishuClient();
    const { app_token, table_id, records } = args;

    if (!app_token || !table_id || !records) {
      throw new Error('app_token、table_id 和 records 参数必须提供');
    }

    const result = await createBitableRecords(client, { app_token, table_id, records });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理更新单条多维表格记录
   */
  private async handleUpdateBitableRecord(args: any) {
    const client = this.ensureFeishuClient();
    const { app_token, table_id, record_id, fields } = args;

    if (!app_token || !table_id || !record_id || !fields) {
      throw new Error('app_token、table_id、record_id 和 fields 参数必须提供');
    }

    const result = await updateBitableRecord(client, { app_token, table_id, record_id, fields });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理批量更新多维表格记录
   */
  private async handleBatchUpdateBitableRecords(args: any) {
    const client = this.ensureFeishuClient();
    const { app_token, table_id, records } = args;

    if (!app_token || !table_id || !records) {
      throw new Error('app_token、table_id 和 records 参数必须提供');
    }

    const result = await batchUpdateBitableRecords(client, { app_token, table_id, records });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理删除多维表格记录
   */
  private async handleDeleteBitableRecords(args: any) {
    const client = this.ensureFeishuClient();
    const { app_token, table_id, record_ids } = args;

    if (!app_token || !table_id || !record_ids) {
      throw new Error('app_token、table_id 和 record_ids 参数必须提供');
    }

    const result = await deleteBitableRecords(client, { app_token, table_id, record_ids });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 处理列出多维表格字段
   */
  private async handleListBitableFields(args: any) {
    const client = this.ensureFeishuClient();
    const { app_token, table_id } = args;

    if (!app_token || !table_id) {
      throw new Error('app_token 和 table_id 参数必须提供');
    }

    const fields = await listBitableFields(client, app_token, table_id);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ total: fields.length, fields }, null, 2),
        },
      ],
    };
  }

  /**
   * 处理创建多维表格字段
   */
  private async handleCreateBitableField(args: any) {
    const client = this.ensureFeishuClient();
    const { app_token, table_id, field_name, type, description, property } = args;

    if (!app_token || !table_id || !field_name || type === undefined) {
      throw new Error('app_token、table_id、field_name 和 type 参数必须提供');
    }

    const field = await createBitableField(client, {
      app_token, table_id, field_name, type, description, property,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(field, null, 2),
        },
      ],
    };
  }

  /**
   * 处理更新多维表格字段
   */
  private async handleUpdateBitableField(args: any) {
    const client = this.ensureFeishuClient();
    const { app_token, table_id, field_id, field_name, type: fieldType, description, property } = args;

    if (!app_token || !table_id || !field_id) {
      throw new Error('app_token、table_id 和 field_id 参数必须提供');
    }

    const field = await updateBitableField(client, {
      app_token, table_id, field_id, field_name, type: fieldType, description, property,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(field, null, 2),
        },
      ],
    };
  }

  /**
   * 处理删除多维表格字段
   */
  private async handleDeleteBitableField(args: any) {
    const client = this.ensureFeishuClient();
    const { app_token, table_id, field_id } = args;

    if (!app_token || !table_id || !field_id) {
      throw new Error('app_token、table_id 和 field_id 参数必须提供');
    }

    const result = await deleteBitableField(client, { app_token, table_id, field_id });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // 日志已移至文件，保持 stdio 干净
  }

  /**
   * 关闭服务器
   */
  async close(): Promise<void> {
    if (this.localCrawler) {
      await this.localCrawler.stopWatching();
    }
    this.database.close();
    await this.server.close();
  }
}
