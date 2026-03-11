import * as lark from '@larksuiteoapi/node-sdk';

/**
 * 从云文档中提取纯文本内容（支持分页）
 */
export async function extractDocxContent(
  client: lark.Client,
  documentId: string
): Promise<string> {
  const allBlocks: any[] = [];
  let pageToken: string | undefined;

  // 分页获取所有块
  do {
    const params: Record<string, unknown> = { page_size: 500 };
    if (pageToken) {
      params.page_token = pageToken;
    }

    const response = await client.docx.documentBlock.list({
      path: { document_id: documentId },
      params: params as any,
    });

    if (!response.data?.items) {
      throw new Error(`获取文档内容失败: ${response.msg}`);
    }

    allBlocks.push(...response.data.items);
    pageToken = response.data.page_token || undefined;
  } while (pageToken);

  // 建立 block_id -> block 映射，用于表格递归
  const blockMap = new Map<string, any>();
  for (const block of allBlocks) {
    blockMap.set(block.block_id, block);
  }

  const textParts: string[] = [];

  for (const block of allBlocks) {
    const text = extractTextFromBlock(block, blockMap);
    if (text) {
      textParts.push(text);
    }
  }

  return textParts.join('\n');
}

/**
 * 从单个块中提取文本
 */
function extractTextFromBlock(block: any, blockMap: Map<string, any>): string {
  const blockType = block.block_type;

  // 页面块
  if (blockType === 1 && block.page?.elements) {
    return extractTextElements(block.page.elements);
  }

  // 文本块
  if (blockType === 2 && block.text?.elements) {
    return extractTextElements(block.text.elements);
  }

  // 标题块 (H1-H9: block_type 3-11)
  if (blockType >= 3 && blockType <= 11) {
    const headingKey = `heading${blockType - 2}`;
    const heading = block[headingKey];
    if (heading?.elements) {
      return extractTextElements(heading.elements);
    }
  }

  // 无序列表 (bullet)
  if (blockType === 12 && block.bullet?.elements) {
    return extractTextElements(block.bullet.elements);
  }

  // 有序列表 (ordered)
  if (blockType === 13 && block.ordered?.elements) {
    return extractTextElements(block.ordered.elements);
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

  // 高亮块 (callout)
  if (blockType === 19 && block.callout?.elements) {
    return extractTextElements(block.callout.elements);
  }

  // 表格块：递归提取子块内容
  if (blockType === 26 && block.children?.length) {
    return extractChildrenText(block.children, blockMap);
  }

  // 表格单元格：递归提取子块内容
  if (blockType === 27 && block.children?.length) {
    return extractChildrenText(block.children, blockMap);
  }

  return '';
}

/**
 * 递归提取子块文本
 */
function extractChildrenText(childIds: string[], blockMap: Map<string, any>): string {
  const parts: string[] = [];
  for (const childId of childIds) {
    const childBlock = blockMap.get(childId);
    if (childBlock) {
      const text = extractTextFromBlock(childBlock, blockMap);
      if (text) {
        parts.push(text);
      }
    }
  }
  return parts.join(' ');
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
