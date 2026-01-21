import * as lark from '@larksuiteoapi/node-sdk';
import { ListDriveFilesInput, GetDriveFileContentInput } from '../types.js';
import { extractDocxContent } from './docx.js';
import { getSpreadsheetContent } from './sheets.js';

/**
 * 云盘文件信息
 */
export interface DriveFile {
  token: string;
  name: string;
  type: string;
  created_time: string;
  modified_time: string;
  owner_id?: string;
}

/**
 * 列出云盘文件夹中的文件
 */
export async function listDriveFiles(
  client: lark.Client,
  input: ListDriveFilesInput
): Promise<{ files: DriveFile[]; has_more: boolean }> {
  const { folder_token, file_type, page_size = 50 } = input;

  const params: Record<string, unknown> = {
    page_size,
    folder_token,
  };

  if (file_type) {
    params.file_type = file_type;
  }

  const response = await client.drive.file.list({
    params: params as any,
  });

  if (!response.data) {
    throw new Error(`获取云盘文件列表失败: ${response.msg}`);
  }

  const files: DriveFile[] = (response.data.files || []).map((file) => ({
    token: file.token || '',
    name: file.name || '',
    type: file.type || '',
    created_time: file.created_time ? new Date(parseInt(file.created_time) * 1000).toISOString() : '',
    modified_time: file.modified_time ? new Date(parseInt(file.modified_time) * 1000).toISOString() : '',
    owner_id: file.owner_id,
  }));

  return {
    files,
    has_more: response.data.has_more || false,
  };
}

/**
 * 获取云盘文件内容
 */
export async function getDriveFileContent(
  client: lark.Client,
  input: GetDriveFileContentInput
): Promise<{ name: string; content: string; type: string }> {
  const { file_token, file_type } = input;

  // 根据文件类型获取内容
  if (file_type === 'docx' || file_type === 'doc') {
    const content = await extractDocxContent(client, file_token);
    return { name: '', content, type: file_type };
  }

  if (file_type === 'sheet') {
    // 电子表格使用 sheets API 获取内容
    const content = await getSpreadsheetContent(client, file_token);
    return { name: '', content, type: file_type };
  }

  if (file_type === 'bitable') {
    return {
      name: '',
      content: '[多维表格类型，请使用 get_bitable_records 工具获取数据]',
      type: file_type,
    };
  }

  // 其他类型暂不支持
  return {
    name: '',
    content: `[${file_type} 类型文件，暂不支持内容提取]`,
    type: file_type,
  };
}

/**
 * 获取文件元信息
 */
export async function getDriveFileMeta(
  client: lark.Client,
  fileToken: string,
  fileType: string
): Promise<{ name: string; owner: string; created_time: string; modified_time: string }> {
  // 使用 list 接口获取文件信息（file.get 在某些 SDK 版本中不可用）
  const response = await client.drive.file.list({
    params: { 
      folder_token: 'root',
      page_size: 200 
    } as any,
  });

  if (!response.data?.files) {
    throw new Error(`获取文件列表失败: ${response.msg}`);
  }

  const file = response.data.files.find((f) => f.token === fileToken);
  
  if (!file) {
    // 如果根目录找不到，返回基本信息
    return {
      name: '',
      owner: '',
      created_time: '',
      modified_time: '',
    };
  }

  return {
    name: file.name || '',
    owner: file.owner_id || '',
    created_time: file.created_time ? new Date(parseInt(file.created_time) * 1000).toISOString() : '',
    modified_time: file.modified_time ? new Date(parseInt(file.modified_time) * 1000).toISOString() : '',
  };
}
