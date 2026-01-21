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
import { Config, SearchFilters } from './types.js';
import {
  getFeishuClient,
  getBitableRecords,
  listBitableTables,
  getWikiNodes,
  getWikiNodeContent,
  extractDocxContent,
  listDriveFiles,
  getDriveFileContent,
  listSheets,
  getSheetData,
  getSpreadsheetContent,
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
            name: 'get_wiki_nodes',
            description: '获取飞书知识空间的节点列表（文档目录）。注意：需要 space_id（数字格式，如 7561364012530434051），不是 node_token',
            inputSchema: {
              type: 'object',
              properties: {
                space_id: {
                  type: 'string',
                  description: '知识空间 ID（数字格式，如 7561364012530434051）',
                },
                parent_node_token: {
                  type: 'string',
                  description: '父节点 token（可选，不传则返回根节点）',
                },
              },
              required: ['space_id'],
            },
          },
          {
            name: 'get_wiki_node_content',
            description: '获取飞书知识库中指定文档的内容。使用 node_token（从 wiki URL 中获取，如 CwrFwxs7jigxPYkVHWHc1wb6nPh）',
            inputSchema: {
              type: 'object',
              properties: {
                node_token: {
                  type: 'string',
                  description: '节点 token（从 wiki URL 获取，如 https://xxx.feishu.cn/wiki/CwrFwxs7jigxPYkVHWHc1wb6nPh 中的 CwrFwxs7jigxPYkVHWHc1wb6nPh）',
                },
                space_id: {
                  type: 'string',
                  description: '知识空间 ID（可选，不提供时会自动获取）',
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
            name: 'list_drive_files',
            description: '列出飞书云盘文件夹中的文件',
            inputSchema: {
              type: 'object',
              properties: {
                folder_token: {
                  type: 'string',
                  description: '文件夹 token（根目录用 "root"）',
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

          // 飞书相关工具
          case 'get_bitable_records':
            return await this.handleGetBitableRecords(args);

          case 'list_bitable_tables':
            return await this.handleListBitableTables(args);

          case 'get_wiki_nodes':
            return await this.handleGetWikiNodes(args);

          case 'get_wiki_node_content':
            return await this.handleGetWikiNodeContent(args);

          case 'get_docx_content':
            return await this.handleGetDocxContent(args);

          case 'list_drive_files':
            return await this.handleListDriveFiles(args);

          case 'get_drive_file_content':
            return await this.handleGetDriveFileContent(args);

          case 'get_sheet_data':
            return await this.handleGetSheetData(args);

          case 'list_sheets':
            return await this.handleListSheets(args);

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
    const results = this.database.searchDocuments(query, filters, limit);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              total: results.length,
              documents: results.map((doc) => ({
                id: doc.id,
                title: doc.title,
                source: doc.source,
                preview: doc.content.substring(0, 200) + '...',
                metadata: doc.metadata,
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
    const { space_id, parent_node_token } = args;

    if (!space_id) {
      throw new Error('space_id 参数必须提供');
    }

    const result = await getWikiNodes(client, { space_id, parent_node_token });

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
    const { space_id, node_token } = args;

    if (!node_token) {
      throw new Error('node_token 参数必须提供');
    }

    const result = await getWikiNodeContent(client, { space_id, node_token });

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
