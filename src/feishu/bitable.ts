import * as lark from '@larksuiteoapi/node-sdk';
import { GetBitableRecordsInput } from '../types.js';

/**
 * 获取多维表格记录（支持筛选、字段选择、排序）
 */
export async function getBitableRecords(
  client: lark.Client,
  input: GetBitableRecordsInput
): Promise<{
  total: number;
  records: Array<{ record_id: string; fields: Record<string, unknown> }>;
}> {
  const { app_token, table_id, view_id, filter, field_names, sort, page_size = 100 } = input;

  const params: Record<string, unknown> = {
    page_size,
  };

  if (view_id) {
    params.view_id = view_id;
  }

  if (filter) {
    params.filter = filter;
  }

  if (field_names && field_names.length > 0) {
    params.field_names = JSON.stringify(field_names);
  }

  if (sort) {
    params.sort = sort;
  }

  const response = await client.bitable.appTableRecord.list({
    path: { app_token, table_id },
    params: params as any,
  });

  if (!response.data) {
    throw new Error(`获取多维表格记录失败: ${response.msg}`);
  }

  const records = (response.data.items || []).map((item) => ({
    record_id: item.record_id || '',
    fields: item.fields || {},
  }));

  return {
    total: response.data.total || records.length,
    records,
  };
}

/**
 * 列出多维表格中的所有数据表
 */
export async function listBitableTables(
  client: lark.Client,
  appToken: string
): Promise<Array<{ table_id: string; name: string; revision: number }>> {
  const response = await client.bitable.appTable.list({
    path: { app_token: appToken },
    params: { page_size: 100 },
  });

  if (!response.data) {
    throw new Error(`获取数据表列表失败: ${response.msg}`);
  }

  return (response.data.items || []).map((item) => ({
    table_id: item.table_id || '',
    name: item.name || '',
    revision: item.revision || 0,
  }));
}
