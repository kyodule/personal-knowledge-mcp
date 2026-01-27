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

/**
 * 创建多维表格记录输入参数
 */
export interface CreateBitableRecordsInput {
  app_token: string;
  table_id: string;
  records: Array<{ fields: Record<string, unknown> }>;
}

/**
 * 更新多维表格记录输入参数
 */
export interface UpdateBitableRecordInput {
  app_token: string;
  table_id: string;
  record_id: string;
  fields: Record<string, unknown>;
}

/**
 * 批量更新多维表格记录输入参数
 */
export interface BatchUpdateBitableRecordsInput {
  app_token: string;
  table_id: string;
  records: Array<{ record_id: string; fields: Record<string, unknown> }>;
}

/**
 * 删除多维表格记录输入参数
 */
export interface DeleteBitableRecordsInput {
  app_token: string;
  table_id: string;
  record_ids: string[];
}

/**
 * 创建多维表格记录（支持批量创建）
 */
export async function createBitableRecords(
  client: lark.Client,
  input: CreateBitableRecordsInput
): Promise<{ records: Array<{ record_id: string; fields: Record<string, unknown> }> }> {
  const { app_token, table_id, records } = input;

  const response = await client.bitable.appTableRecord.batchCreate({
    path: { app_token, table_id },
    data: { records: records as any },
  });

  if (!response.data) {
    throw new Error(`创建多维表格记录失败: ${response.msg}`);
  }

  return {
    records: (response.data.records || []).map((item) => ({
      record_id: item.record_id || '',
      fields: item.fields || {},
    })),
  };
}

/**
 * 更新单条多维表格记录
 */
export async function updateBitableRecord(
  client: lark.Client,
  input: UpdateBitableRecordInput
): Promise<{ record_id: string; fields: Record<string, unknown> }> {
  const { app_token, table_id, record_id, fields } = input;

  const response = await client.bitable.appTableRecord.update({
    path: { app_token, table_id, record_id },
    data: { fields: fields as any },
  });

  if (!response.data?.record) {
    throw new Error(`更新多维表格记录失败: ${response.msg}`);
  }

  return {
    record_id: response.data.record.record_id || '',
    fields: response.data.record.fields || {},
  };
}

/**
 * 批量更新多维表格记录
 */
export async function batchUpdateBitableRecords(
  client: lark.Client,
  input: BatchUpdateBitableRecordsInput
): Promise<{ records: Array<{ record_id: string; fields: Record<string, unknown> }> }> {
  const { app_token, table_id, records } = input;

  const response = await client.bitable.appTableRecord.batchUpdate({
    path: { app_token, table_id },
    data: { records: records as any },
  });

  if (!response.data) {
    throw new Error(`批量更新多维表格记录失败: ${response.msg}`);
  }

  return {
    records: (response.data.records || []).map((item) => ({
      record_id: item.record_id || '',
      fields: item.fields || {},
    })),
  };
}

/**
 * 删除多维表格记录（支持批量删除）
 */
export async function deleteBitableRecords(
  client: lark.Client,
  input: DeleteBitableRecordsInput
): Promise<{ deleted_count: number }> {
  const { app_token, table_id, record_ids } = input;

  const response = await client.bitable.appTableRecord.batchDelete({
    path: { app_token, table_id },
    data: { records: record_ids },
  });

  if (response.code !== 0) {
    throw new Error(`删除多维表格记录失败: ${response.msg}`);
  }

  return {
    deleted_count: record_ids.length,
  };
}
