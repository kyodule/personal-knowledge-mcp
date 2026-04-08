import * as lark from '@larksuiteoapi/node-sdk';
import { GetBitableRecordsInput } from '../types.js';

// ============================================================
// 字段管理 (Field CRUD)
// ============================================================

/**
 * 多维表格字段信息
 */
export interface BitableField {
  field_id: string;
  field_name: string;
  type: number;
  description?: string;
  property?: Record<string, unknown>;
}

/**
 * 列出多维表格的所有字段
 */
export async function listBitableFields(
  client: lark.Client,
  appToken: string,
  tableId: string
): Promise<BitableField[]> {
  const allFields: BitableField[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, unknown> = { page_size: 100 };
    if (pageToken) {
      params.page_token = pageToken;
    }

    const response = await client.bitable.appTableField.list({
      path: { app_token: appToken, table_id: tableId },
      params: params as any,
    });

    if (!response.data) {
      throw new Error(`获取字段列表失败: ${response.msg}`);
    }

    const fields = (response.data.items || []).map((item) => ({
      field_id: item.field_id || '',
      field_name: item.field_name || '',
      type: item.type || 0,
      description: (item as any).description || undefined,
      property: item.property as Record<string, unknown> | undefined,
    }));

    allFields.push(...fields);
    pageToken = response.data.page_token || undefined;
  } while (pageToken);

  return allFields;
}

/**
 * 创建多维表格字段输入参数
 */
export interface CreateBitableFieldInput {
  app_token: string;
  table_id: string;
  field_name: string;
  type: number;
  description?: string;
  property?: Record<string, unknown>;
}

/**
 * 创建多维表格字段
 *
 * 常用 type 值：
 *  1 = 文本, 2 = 数字, 3 = 单选, 4 = 多选, 5 = 日期,
 *  7 = 复选框, 11 = 人员, 13 = 电话, 15 = URL,
 *  17 = 附件, 18 = 单向关联, 19 = 查找引用, 20 = 公式,
 *  21 = 双向关联, 22 = 地理位置, 23 = 群组, 1001 = 创建时间,
 *  1002 = 最后更新时间, 1003 = 创建人, 1004 = 最后更新人
 */
export async function createBitableField(
  client: lark.Client,
  input: CreateBitableFieldInput
): Promise<BitableField> {
  const { app_token, table_id, field_name, type, description, property } = input;

  const data: Record<string, unknown> = {
    field_name,
    type,
  };
  if (description) {
    data.description = description;
  }
  if (property) {
    data.property = property;
  }

  const response = await client.bitable.appTableField.create({
    path: { app_token, table_id },
    data: data as any,
  });

  if (!response.data?.field) {
    throw new Error(`创建字段失败: ${response.msg}`);
  }

  const field = response.data.field;
  return {
    field_id: field.field_id || '',
    field_name: field.field_name || '',
    type: field.type || 0,
    description: (field as any).description || undefined,
    property: field.property as Record<string, unknown> | undefined,
  };
}

/**
 * 更新多维表格字段输入参数
 */
export interface UpdateBitableFieldInput {
  app_token: string;
  table_id: string;
  field_id: string;
  field_name?: string;
  type?: number;
  description?: string;
  property?: Record<string, unknown>;
}

/**
 * 更新多维表格字段（重命名、修改类型或属性）
 */
export async function updateBitableField(
  client: lark.Client,
  input: UpdateBitableFieldInput
): Promise<BitableField> {
  const { app_token, table_id, field_id, field_name, type, description, property } = input;

  const data: Record<string, unknown> = {};
  if (field_name !== undefined) data.field_name = field_name;
  if (type !== undefined) data.type = type;
  if (description !== undefined) data.description = description;
  if (property !== undefined) data.property = property;

  const response = await client.bitable.appTableField.update({
    path: { app_token, table_id, field_id },
    data: data as any,
  });

  if (!response.data?.field) {
    throw new Error(`更新字段失败: ${response.msg}`);
  }

  const field = response.data.field;
  return {
    field_id: field.field_id || '',
    field_name: field.field_name || '',
    type: field.type || 0,
    description: (field as any).description || undefined,
    property: field.property as Record<string, unknown> | undefined,
  };
}

/**
 * 删除多维表格字段输入参数
 */
export interface DeleteBitableFieldInput {
  app_token: string;
  table_id: string;
  field_id: string;
}

/**
 * 删除多维表格字段
 */
export async function deleteBitableField(
  client: lark.Client,
  input: DeleteBitableFieldInput
): Promise<{ deleted: boolean }> {
  const { app_token, table_id, field_id } = input;

  const response = await client.bitable.appTableField.delete({
    path: { app_token, table_id, field_id },
  });

  if (response.code !== 0) {
    throw new Error(`删除字段失败: ${response.msg}`);
  }

  return { deleted: true };
}

/**
 * 获取多维表格记录（支持筛选、字段选择、排序、自动分页）
 */
export async function getBitableRecords(
  client: lark.Client,
  input: GetBitableRecordsInput
): Promise<{
  total: number;
  records: Array<{ record_id: string; fields: Record<string, unknown> }>;
}> {
  const { app_token, table_id, view_id, filter, field_names, sort, page_size = 100 } = input;
  const allRecords: Array<{ record_id: string; fields: Record<string, unknown> }> = [];
  let pageToken: string | undefined;
  let total = 0;

  do {
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
      params.field_names = field_names;
    }

    if (sort) {
      params.sort = sort;
    }

    if (pageToken) {
      params.page_token = pageToken;
    }

    const response = await client.bitable.appTableRecord.list({
      path: { app_token, table_id },
      params: params as any,
    });

    if (!response.data) {
      throw new Error(`获取多维表格记录失败: ${response.msg}`);
    }

    total = response.data.total || 0;

    const records = (response.data.items || []).map((item) => ({
      record_id: item.record_id || '',
      fields: item.fields || {},
    }));

    allRecords.push(...records);
    pageToken = response.data.page_token || undefined;
  } while (pageToken);

  return {
    total,
    records: allRecords,
  };
}

/**
 * 列出多维表格中的所有数据表（支持分页）
 */
export async function listBitableTables(
  client: lark.Client,
  appToken: string
): Promise<Array<{ table_id: string; name: string; revision: number }>> {
  const allTables: Array<{ table_id: string; name: string; revision: number }> = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, unknown> = { page_size: 100 };
    if (pageToken) {
      params.page_token = pageToken;
    }

    const response = await client.bitable.appTable.list({
      path: { app_token: appToken },
      params: params as any,
    });

    if (!response.data) {
      throw new Error(`获取数据表列表失败: ${response.msg}`);
    }

    const tables = (response.data.items || []).map((item) => ({
      table_id: item.table_id || '',
      name: item.name || '',
      revision: item.revision || 0,
    }));

    allTables.push(...tables);
    pageToken = response.data.page_token || undefined;
  } while (pageToken);

  return allTables;
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
