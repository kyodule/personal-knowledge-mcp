import * as lark from '@larksuiteoapi/node-sdk';
import { GetWikiNodesInput, GetWikiNodeContentInput } from '../types.js';
import { extractDocxContent } from './docx.js';
import { getSpreadsheetContent } from './sheets.js';
import { listBitableTables, getBitableRecords } from './bitable.js';

/**
 * 知识空间信息
 */
export interface WikiSpace {
  space_id: string;
  name: string;
  description: string;
  space_type: string;
}

/**
 * 知识空间节点信息
 */
export interface WikiNode {
  node_token: string;
  obj_token: string;
  obj_type: string;
  title: string;
  has_child: boolean;
  parent_node_token?: string;
  children?: WikiNode[];
}

/**
 * 获取多维表格内容并格式化为 Markdown
 */
async function getBitableContent(
  client: lark.Client,
  appToken: string
): Promise<string> {
  // 获取所有数据表
  const tables = await listBitableTables(client, appToken);

  if (tables.length === 0) {
    return '[多维表格为空]';
  }

  const contentParts: string[] = [];

  for (const table of tables) {
    try {
      // 获取表记录（限制 200 条）
      const result = await getBitableRecords(client, {
        app_token: appToken,
        table_id: table.table_id,
        page_size: 200,
      });

      if (result.records.length > 0) {
        const tableContent = formatBitableAsMarkdown(result.records, table.name);
        contentParts.push(tableContent);
      } else {
        contentParts.push(`## ${table.name}\n\n[空表]`);
      }
    } catch (err) {
      contentParts.push(`## ${table.name}\n\n[读取失败: ${err}]`);
    }
  }

  return contentParts.join('\n\n---\n\n') || '[多维表格无数据]';
}

/**
 * 将多维表格记录格式化为 Markdown 表格
 */
function formatBitableAsMarkdown(
  records: Array<{ record_id: string; fields: Record<string, unknown> }>,
  tableName: string
): string {
  if (records.length === 0) {
    return `## ${tableName}\n\n[空表]`;
  }

  // 收集所有字段名
  const fieldSet = new Set<string>();
  for (const record of records) {
    Object.keys(record.fields).forEach((key) => fieldSet.add(key));
  }
  const fields = Array.from(fieldSet);

  if (fields.length === 0) {
    return `## ${tableName}\n\n[无字段]`;
  }

  const lines: string[] = [`## ${tableName}\n`];

  // 表头
  const headers = fields.map((f) => f.replace(/\|/g, '\\|').replace(/\n/g, ' '));
  lines.push('| ' + headers.join(' | ') + ' |');
  lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');

  // 数据行
  for (const record of records) {
    const cells = fields.map((field) => {
      const value = record.fields[field];
      return formatCellValue(value);
    });
    lines.push('| ' + cells.join(' | ') + ' |');
  }

  return lines.join('\n');
}

/**
 * 格式化单元格值
 */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  // 处理数组（如多选、人员等）
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === 'object' && v !== null) {
          // 人员字段
          if ('name' in v) return (v as { name: string }).name;
          // 链接字段
          if ('text' in v) return (v as { text: string }).text;
          return JSON.stringify(v);
        }
        return String(v);
      })
      .join(', ')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');
  }

  // 处理对象
  if (typeof value === 'object') {
    // 人员字段
    if ('name' in value) return ((value as { name: string }).name || '').replace(/\|/g, '\\|');
    // 链接字段
    if ('text' in value) return ((value as { text: string }).text || '').replace(/\|/g, '\\|');
    return JSON.stringify(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  }

  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * 获取知识空间列表
 */
export async function listWikiSpaces(
  client: lark.Client
): Promise<{ spaces: WikiSpace[]; hint?: string }> {
  const allSpaces: WikiSpace[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, unknown> = { page_size: 50 };
    if (pageToken) {
      params.page_token = pageToken;
    }

    const response = await client.wiki.space.list({
      params: params as any,
    });

    if (!response.data) {
      throw new Error(`获取知识空间列表失败: ${response.msg}`);
    }

    const spaces = (response.data.items || []).map((item) => ({
      space_id: item.space_id || '',
      name: item.name || '',
      description: item.description || '',
      space_type: item.space_type || '',
    }));

    allSpaces.push(...spaces);
    pageToken = response.data.page_token || undefined;
  } while (pageToken);

  if (allSpaces.length === 0) {
    return {
      spaces: [],
      hint: '未找到任何知识空间。请确认：1) 应用已被添加为知识空间成员或管理员；2) 已开启 wiki:wiki 或 wiki:wiki.readonly 权限。参考：https://open.feishu.cn/document/server-docs/docs/wiki-v2/wiki-qa#b5da330b',
    };
  }

  return { spaces: allSpaces };
}

/**
 * 获取单层子节点列表（内部分页）
 */
async function listChildNodes(
  client: lark.Client,
  space_id: string,
  parent_node_token?: string
): Promise<WikiNode[]> {
  const allNodes: WikiNode[] = [];
  let pageToken: string | undefined;
  let emptyPages = 0;

  do {
    const params: Record<string, unknown> = { page_size: 50 };
    if (parent_node_token) {
      params.parent_node_token = parent_node_token;
    }
    if (pageToken) {
      params.page_token = pageToken;
    }

    const response = await client.wiki.spaceNode.list({
      path: { space_id },
      params: params as any,
    });

    if (!response.data) {
      throw new Error(`获取知识空间节点失败: ${response.msg}`);
    }

    const items = response.data.items || [];
    const nodes = items.map((item) => ({
      node_token: item.node_token || '',
      obj_token: item.obj_token || '',
      obj_type: item.obj_type || '',
      title: item.title || '',
      has_child: item.has_child || false,
      parent_node_token: item.parent_node_token,
    }));

    allNodes.push(...nodes);

    // 官方文档：由于权限过滤，可能返回空列表但 has_more=true，需继续分页
    if (items.length === 0) {
      emptyPages++;
      // 连续 3 页空结果则停止，避免无限循环
      if (emptyPages >= 3) break;
    } else {
      emptyPages = 0;
    }

    pageToken = response.data.page_token || undefined;
  } while (pageToken);

  return allNodes;
}

/**
 * 获取知识空间节点列表（支持分页和递归）
 */
export async function getWikiNodes(
  client: lark.Client,
  input: GetWikiNodesInput
): Promise<{ nodes: WikiNode[]; hint?: string }> {
  const { space_id, parent_node_token, recursive } = input;

  const nodes = await listChildNodes(client, space_id, parent_node_token);

  if (recursive) {
    for (const node of nodes) {
      if (node.has_child) {
        const childNodes = await getWikiNodesRecursive(client, space_id, node.node_token);
        node.children = childNodes;
      }
    }
  }

  const result: { nodes: WikiNode[]; hint?: string } = { nodes };

  if (nodes.length === 0) {
    result.hint = '未找到任何节点。可能原因：1) 权限过滤导致不可见（应用需被添加为知识空间成员）；2) 该节点下确实没有子文档；3) space_id 不正确。参考：https://open.feishu.cn/document/server-docs/docs/wiki-v2/wiki-qa#b5da330b';
  }

  return result;
}

/**
 * 递归获取子节点（深度优先）
 */
async function getWikiNodesRecursive(
  client: lark.Client,
  space_id: string,
  parent_node_token: string
): Promise<WikiNode[]> {
  const nodes = await listChildNodes(client, space_id, parent_node_token);

  for (const node of nodes) {
    if (node.has_child) {
      node.children = await getWikiNodesRecursive(client, space_id, node.node_token);
    }
  }

  return nodes;
}

/**
 * 获取知识库节点的文档内容
 * 始终使用 get_node 接口直接获取节点信息（无需 space_id，无需遍历）
 */
export async function getWikiNodeContent(
  client: lark.Client,
  input: GetWikiNodeContentInput
): Promise<{ title: string; content: string; obj_type: string; space_id: string; has_child: boolean }> {
  const { node_token } = input;

  // 始终使用 get_node 接口，只需 token 即可，不需要 space_id
  const nodeResponse = await client.wiki.space.getNode({
    params: { token: node_token } as any,
  });

  if (!nodeResponse.data?.node) {
    const errMsg = nodeResponse.msg || '未知错误';
    throw new Error(
      `获取节点信息失败: ${errMsg}。请确认：1) node_token 正确（从 wiki URL 中 /wiki/ 后的部分）；2) 应用有该节点的阅读权限。`
    );
  }

  const node = nodeResponse.data.node;
  const objToken = node.obj_token || '';
  const objType = node.obj_type || '';
  const title = node.title || '';
  const spaceId = (node as any).space_id || '';
  const hasChild = (node as any).has_child || false;

  const base = { title, obj_type: objType, space_id: spaceId, has_child: hasChild };

  // 根据文档类型获取内容
  if (objType === 'docx' || objType === 'doc') {
    const content = await extractDocxContent(client, objToken);
    return { ...base, content };
  }

  if (objType === 'sheet') {
    const content = await getSpreadsheetContent(client, objToken);
    return { ...base, content };
  }

  if (objType === 'bitable') {
    const content = await getBitableContent(client, objToken);
    return { ...base, content };
  }

  return {
    ...base,
    content: `[${objType} 类型文档，暂不支持内容提取。支持的类型: docx, doc, sheet, bitable]`,
  };
}
