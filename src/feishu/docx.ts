import * as lark from '@larksuiteoapi/node-sdk';

/**
 * 从云文档中提取纯文本内容
 */
export async function extractDocxContent(
  client: lark.Client,
  documentId: string
): Promise<string> {
  // 获取文档的所有块
  const response = await client.docx.documentBlock.list({
    path: { document_id: documentId },
    params: { page_size: 500 },
  });

  if (!response.data?.items) {
    throw new Error(`获取文档内容失败: ${response.msg}`);
  }

  const textParts: string[] = [];

  for (const block of response.data.items) {
    const text = extractTextFromBlock(block);
    if (text) {
      textParts.push(text);
    }
  }

  return textParts.join('\n');
}

/**
 * 从单个块中提取文本
 */
function extractTextFromBlock(block: any): string {
  const blockType = block.block_type;

  // 文本块
  if (blockType === 2 && block.text?.elements) {
    return extractTextElements(block.text.elements);
  }

  // 标题块 (H1-H9: block_type 3-11)
  if (blockType >= 3 && blockType <= 11 && block.heading1?.elements) {
    const headingKey = `heading${blockType - 2}`;
    const heading = block[headingKey];
    if (heading?.elements) {
      return extractTextElements(heading.elements);
    }
  }

  // 有序列表
  if (blockType === 12 && block.ordered?.elements) {
    return extractTextElements(block.ordered.elements);
  }

  // 无序列表
  if (blockType === 13 && block.bullet?.elements) {
    return extractTextElements(block.bullet.elements);
  }

  // 代码块
  if (blockType === 14 && block.code?.elements) {
    return extractTextElements(block.code.elements);
  }

  // 引用块
  if (blockType === 15 && block.quote?.elements) {
    return extractTextElements(block.quote.elements);
  }

  // 待办事项
  if (blockType === 17 && block.todo?.elements) {
    return extractTextElements(block.todo.elements);
  }

  // 表格单元格
  if (blockType === 27 && block.table_cell) {
    // 表格单元格的内容在子块中，这里返回空
    return '';
  }

  return '';
}

/**
 * 从文本元素数组中提取纯文本
 */
function extractTextElements(elements: any[]): string {
  if (!Array.isArray(elements)) {
    return '';
  }

  const parts: string[] = [];

  for (const element of elements) {
    if (element.text_run?.content) {
      parts.push(element.text_run.content);
    } else if (element.mention_user?.user_id) {
      parts.push(`@用户`);
    } else if (element.mention_doc?.title) {
      parts.push(`[${element.mention_doc.title}]`);
    }
  }

  return parts.join('');
}

/**
 * 获取云文档元信息
 */
export async function getDocxMeta(
  client: lark.Client,
  documentId: string
): Promise<{ title: string; revision: number }> {
  const response = await client.docx.document.get({
    path: { document_id: documentId },
  });

  if (!response.data?.document) {
    throw new Error(`获取文档元信息失败: ${response.msg}`);
  }

  return {
    title: response.data.document.title || '',
    revision: response.data.document.revision_id || 0,
  };
}
