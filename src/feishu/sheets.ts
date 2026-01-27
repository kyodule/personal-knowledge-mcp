import * as lark from '@larksuiteoapi/node-sdk';

/**
 * 电子表格工作表信息
 */
export interface SheetInfo {
  sheet_id: string;
  title: string;
  index: number;
  hidden: boolean;
  row_count?: number;
  column_count?: number;
}

/**
 * 获取电子表格数据参数
 */
export interface GetSheetDataInput {
  spreadsheet_token: string;
  sheet_id?: string;
  range?: string;
  value_render_option?: 'ToString' | 'FormattedValue' | 'Formula' | 'UnformattedValue';
}

/**
 * 电子表格数据结果
 */
export interface SheetDataResult {
  spreadsheet_token: string;
  sheets?: SheetInfo[];
  values?: unknown[][];
  range?: string;
  revision?: number;
}

/**
 * 获取电子表格中所有工作表
 */
export async function listSheets(
  client: lark.Client,
  spreadsheetToken: string
): Promise<SheetInfo[]> {
  const response = await client.sheets.spreadsheetSheet.query({
    path: { spreadsheet_token: spreadsheetToken },
  });

  if (!response.data?.sheets) {
    throw new Error(`获取工作表列表失败: ${response.msg || '未知错误'}`);
  }

  return response.data.sheets.map((sheet) => ({
    sheet_id: sheet.sheet_id || '',
    title: sheet.title || '',
    index: sheet.index || 0,
    hidden: sheet.hidden || false,
    row_count: sheet.grid_properties?.row_count,
    column_count: sheet.grid_properties?.column_count,
  }));
}

/**
 * 读取电子表格指定范围的数据
 * 使用 v2 API: GET /sheets/v2/spreadsheets/:spreadsheetToken/values/:range
 */
export async function getSheetData(
  client: lark.Client,
  input: GetSheetDataInput
): Promise<SheetDataResult> {
  const { spreadsheet_token, sheet_id, range, value_render_option } = input;

  // 如果没有指定 sheet_id，先获取第一个工作表
  let targetSheetId = sheet_id;
  if (!targetSheetId) {
    const sheets = await listSheets(client, spreadsheet_token);
    if (sheets.length === 0) {
      throw new Error('电子表格中没有工作表');
    }
    targetSheetId = sheets[0].sheet_id;
  }

  // 构建范围字符串，格式：sheetId!A1:Z1000 或 sheetId（读取整个工作表）
  const rangeStr = range ? `${targetSheetId}!${range}` : targetSheetId;

  // 构建查询参数
  const queryParams: Record<string, string> = {};
  if (value_render_option) {
    queryParams.valueRenderOption = value_render_option;
  }
  queryParams.dateTimeRenderOption = 'FormattedString';

  const queryString = Object.entries(queryParams)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  // 使用 client.request 调用 v2 API
  const response = await (client as any).request({
    method: 'GET',
    url: `/open-apis/sheets/v2/spreadsheets/${spreadsheet_token}/values/${encodeURIComponent(rangeStr)}${queryString ? '?' + queryString : ''}`,
    data: {},
    params: {},
  });

  if (response.code !== 0) {
    throw new Error(`读取电子表格数据失败: ${response.msg || '未知错误'}`);
  }

  const valueRange = response.data?.valueRange;

  return {
    spreadsheet_token,
    values: valueRange?.values || [],
    range: valueRange?.range,
    revision: valueRange?.revision,
  };
}

/**
 * 获取电子表格所有内容（合并所有工作表）
 */
export async function getSpreadsheetContent(
  client: lark.Client,
  spreadsheetToken: string,
  maxRows: number = 500
): Promise<string> {
  // 获取所有工作表
  const sheets = await listSheets(client, spreadsheetToken);

  if (sheets.length === 0) {
    return '[电子表格为空]';
  }

  const contentParts: string[] = [];

  for (const sheet of sheets) {
    if (sheet.hidden) {
      continue;
    }

    try {
      // 计算读取范围，限制行数
      const rowCount = Math.min(sheet.row_count || 200, maxRows);
      const colCount = Math.min(sheet.column_count || 26, 26);
      const endCol = columnIndexToLetter(colCount - 1);
      const range = `A1:${endCol}${rowCount}`;

      const data = await getSheetData(client, {
        spreadsheet_token: spreadsheetToken,
        sheet_id: sheet.sheet_id,
        range,
        value_render_option: 'FormattedValue',
      });

      if (data.values && data.values.length > 0) {
        // 将数据格式化为 Markdown 表格
        const tableContent = formatAsMarkdownTable(data.values, sheet.title);
        contentParts.push(tableContent);
      }
    } catch (err) {
      contentParts.push(`## ${sheet.title}\n\n[读取失败: ${err}]\n`);
    }
  }

  return contentParts.join('\n\n---\n\n') || '[电子表格无数据]';
}

/**
 * 将数字列索引转换为字母（0 -> A, 25 -> Z, 26 -> AA）
 */
function columnIndexToLetter(index: number): string {
  let result = '';
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

/**
 * 将二维数组格式化为 Markdown 表格
 */
function formatAsMarkdownTable(values: unknown[][], sheetTitle: string): string {
  if (values.length === 0) {
    return `## ${sheetTitle}\n\n[空表]`;
  }

  const lines: string[] = [`## ${sheetTitle}\n`];

  // 获取最大列数
  const maxCols = Math.max(...values.map((row) => (Array.isArray(row) ? row.length : 0)));

  if (maxCols === 0) {
    return `## ${sheetTitle}\n\n[空表]`;
  }

  // 处理第一行作为表头
  const headerRow = values[0] as unknown[];
  const headers = Array(maxCols)
    .fill('')
    .map((_, i) => String(headerRow[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '));
  lines.push('| ' + headers.join(' | ') + ' |');
  lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');

  // 处理数据行
  for (let i = 1; i < values.length; i++) {
    const row = values[i] as unknown[];
    if (!row || row.every((cell) => cell === null || cell === undefined || cell === '')) {
      continue;
    }
    const cells = Array(maxCols)
      .fill('')
      .map((_, j) => String(row[j] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' '));
    lines.push('| ' + cells.join(' | ') + ' |');
  }

  return lines.join('\n');
}

/**
 * 写入电子表格数据参数
 */
export interface WriteSheetDataInput {
  spreadsheet_token: string;
  sheet_id?: string;
  range: string;
  values: unknown[][];
}

/**
 * 追加电子表格数据参数
 */
export interface AppendSheetDataInput {
  spreadsheet_token: string;
  sheet_id?: string;
  values: unknown[][];
}

/**
 * 写入电子表格指定范围的数据
 * 使用 v2 API: PUT /sheets/v2/spreadsheets/:spreadsheetToken/values
 * 
 * 调用示例：
 * - range: "A1:C3" (会自动加上 sheet_id)
 * - range: "0FWSSB!A1:C3" (完整格式，直接使用)
 * - values: [["行1列1", "行1列2"], ["行2列1", "行2列2"]]
 */
export async function writeSheetData(
  client: lark.Client,
  input: WriteSheetDataInput
): Promise<{ updated_cells: number; updated_rows: number; updated_columns: number; range: string }> {
  const { spreadsheet_token, sheet_id, range, values } = input;

  // 构建范围字符串
  let rangeStr: string;
  if (range.includes('!')) {
    // 用户已经传了完整的 range（如 0FWSSB!A1:C3），直接使用
    rangeStr = range;
  } else if (sheet_id) {
    // 用户传了 sheet_id 和 range（如 A1:C3）
    rangeStr = `${sheet_id}!${range}`;
  } else {
    // 没有 sheet_id，获取第一个工作表
    const sheets = await listSheets(client, spreadsheet_token);
    if (sheets.length === 0) {
      throw new Error('电子表格中没有工作表');
    }
    rangeStr = `${sheets[0].sheet_id}!${range}`;
  }

  // 使用 v2 API 写入数据
  // 文档: https://open.feishu.cn/document/server-docs/docs/sheets-v3/data-operation/write-data-to-a-single-range
  const response = await (client as any).request({
    method: 'PUT',
    url: `/open-apis/sheets/v2/spreadsheets/${spreadsheet_token}/values`,
    data: {
      valueRange: {
        range: rangeStr,
        values,
      },
    },
    params: {},
  });

  // 调试输出
  if (response.code !== 0) {
    throw new Error(`写入电子表格数据失败: ${response.msg || '未知错误'} (code: ${response.code}, range: ${rangeStr})`);
  }

  return {
    updated_cells: response.data?.updatedCells || 0,
    updated_rows: response.data?.updatedRows || 0,
    updated_columns: response.data?.updatedColumns || 0,
    range: rangeStr,
  };
}

/**
 * 追加电子表格数据（在已有数据后追加新行）
 * 使用 v2 API: POST /sheets/v2/spreadsheets/:spreadsheetToken/values_append
 */
export async function appendSheetData(
  client: lark.Client,
  input: AppendSheetDataInput
): Promise<{ updated_cells: number; updated_rows: number; updated_columns: number }> {
  const { spreadsheet_token, sheet_id, values } = input;

  // 如果没有指定 sheet_id，先获取第一个工作表
  let targetSheetId = sheet_id;
  if (!targetSheetId) {
    const sheets = await listSheets(client, spreadsheet_token);
    if (sheets.length === 0) {
      throw new Error('电子表格中没有工作表');
    }
    targetSheetId = sheets[0].sheet_id;
  }

  const response = await (client as any).request({
    method: 'POST',
    url: `/open-apis/sheets/v2/spreadsheets/${spreadsheet_token}/values_append`,
    data: {
      valueRange: {
        range: targetSheetId,
        values,
      },
    },
    params: {
      insertDataOption: 'INSERT_ROWS',
    },
  });

  if (response.code !== 0) {
    throw new Error(`追加电子表格数据失败: ${response.msg || '未知错误'}`);
  }

  return {
    updated_cells: response.data?.updates?.updatedCells || 0,
    updated_rows: response.data?.updates?.updatedRows || 0,
    updated_columns: response.data?.updates?.updatedColumns || 0,
  };
}
