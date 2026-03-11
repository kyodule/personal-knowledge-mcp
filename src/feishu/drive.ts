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
 * 列出云盘文件夹中的文件（支持分页）
 */
export async function listDriveFiles(
  client: lark.Client,
  input: ListDriveFilesInput
): Promise<{ files: DriveFile[]; has_more: boolean }> {
  const { folder_token, file_type, page_size = 50 } = input;
  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;
  let hasMore = false;

  do {
    const params: Record<string, unknown> = {
      page_size,
      folder_token,
    };

    if (file_type) {
      params.file_type = file_type;
    }

    if (pageToken) {
      params.page_token = pageToken;
    }

    const response = await client.drive.file.list({
      params: params as any,
    });

    if (!response.data) {
      throw new Error(`获取云盘文件列表失败: ${response.msg}`);
    }

    const files = (response.data.files || []).map((file) => ({
      token: file.token || '',
      name: file.name || '',
      type: file.type || '',
      created_time: file.created_time ? new Date(parseInt(file.created_time) * 1000).toISOString() : '',
      modified_time: file.modified_time ? new Date(parseInt(file.modified_time) * 1000).toISOString() : '',
      owner_id: file.owner_id,
    }));

    allFiles.push(...files);
    hasMore = response.data.has_more || false;
    pageToken = response.data.next_page_token || undefined;
  } while (pageToken);

  return {
    files: allFiles,
    has_more: hasMore,
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
 * 使用 meta batch 接口，不依赖文件夹位置
 */
export async function getDriveFileMeta(
  client: lark.Client,
  fileToken: string,
  fileType: string
): Promise<{ name: string; owner: string; created_time: string; modified_time: string }> {
  try {
    const response = await (client as any).request({
      method: 'POST',
      url: '/open-apis/drive/v1/metas/batch_query',
      data: {
        request_docs: [{ doc_token: fileToken, doc_type: fileType }],
      },
      params: {},
    });

    if (response.code === 0 && response.data?.metas?.length > 0) {
      const meta = response.data.metas[0];
      return {
        name: meta.title || '',
        owner: meta.owner_id || '',
        created_time: meta.create_time ? new Date(parseInt(meta.create_time) * 1000).toISOString() : '',
        modified_time: meta.latest_modify_time ? new Date(parseInt(meta.latest_modify_time) * 1000).toISOString() : '',
      };
    }
  } catch {
    // fallback below
  }

  return {
    name: '',
    owner: '',
    created_time: '',
    modified_time: '',
  };
}
