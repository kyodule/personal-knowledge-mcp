import * as lark from '@larksuiteoapi/node-sdk';
import { GetWikiNodesInput, GetWikiNodeContentInput } from '../types.js';
import { extractDocxContent } from './docx.js';
import { getSpreadsheetContent } from './sheets.js';
import { listBitableTables, getBitableRecords } from './bitable.js';

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
 * 获取知识空间节点列表
 */
export async function getWikiNodes(
  client: lark.Client,
  input: GetWikiNodesInput
): Promise<{ nodes: WikiNode[] }> {
  const { space_id, parent_node_token } = input;

  const params: Record<string, unknown> = {
    page_size: 50,
  };

  if (parent_node_token) {
    params.parent_node_token = parent_node_token;
  }

  const response = await client.wiki.spaceNode.list({
    path: { space_id },
    params: params as any,
  });

  if (!response.data) {
    throw new Error(`获取知识空间节点失败: ${response.msg}`);
  }

  const nodes: WikiNode[] = (response.data.items || []).map((item) => ({
    node_token: item.node_token || '',
    obj_token: item.obj_token || '',
    obj_type: item.obj_type || '',
    title: item.title || '',
    has_child: item.has_child || false,
    parent_node_token: item.parent_node_token,
  }));

  return { nodes };
}

/**
 * 获取知识库节点的文档内容
 * 支持只传 node_token（会自动获取节点信息）
 */
export async function getWikiNodeContent(
  client: lark.Client,
  input: GetWikiNodeContentInput
): Promise<{ title: string; content: string; obj_type: string }> {
  const { space_id, node_token } = input;

  let objToken: string;
  let objType: string;
  let title: string;

  if (space_id) {
    // 如果提供了 space_id，通过 list 接口获取节点信息
    const listResponse = await client.wiki.spaceNode.list({
      path: { space_id },
      params: { page_size: 500 } as any,
    });

    if (!listResponse.data?.items) {
      throw new Error(`获取知识库节点列表失败: ${listResponse.msg}`);
    }

    // 查找目标节点
    const node = listResponse.data.items.find((item) => item.node_token === node_token);
    
    if (!node) {
      throw new Error(`未找到节点: ${node_token}`);
    }

    objToken = node.obj_token || '';
    objType = node.obj_type || '';
    title = node.title || '';
  } else {
    // 如果没有 space_id，使用 getNode 接口直接获取节点信息
    const nodeResponse = await client.wiki.space.getNode({
      params: { token: node_token } as any,
    });

    if (!nodeResponse.data?.node) {
      throw new Error(`获取节点信息失败: ${nodeResponse.msg}`);
    }

    const node = nodeResponse.data.node;
    objToken = node.obj_token || '';
    objType = node.obj_type || '';
    title = node.title || '';
  }

  // 根据文档类型获取内容
  if (objType === 'docx' || objType === 'doc') {
    const content = await extractDocxContent(client, objToken);
    return { title, content, obj_type: objType };
  }

  // 电子表格类型
  if (objType === 'sheet') {
    const content = await getSpreadsheetContent(client, objToken);
    return { title, content, obj_type: objType };
  }

  // 多维表格类型
  if (objType === 'bitable') {
    const content = await getBitableContent(client, objToken);
    return { title, content, obj_type: objType };
  }

  // 其他类型暂不支持，返回基本信息
  return {
    title,
    content: `[${objType} 类型文档，暂不支持内容提取。支持的类型: docx, doc, sheet, bitable]`,
    obj_type: objType,
  };
}
