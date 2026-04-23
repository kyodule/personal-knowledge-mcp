import * as lark from '@larksuiteoapi/node-sdk';

// 飞书文档 block_type 常量
const BLOCK_TYPE = {
  PAGE: 1,
  TEXT: 2,
  HEADING1: 3,
  HEADING2: 4,
  HEADING3: 5,
  HEADING4: 6,
  HEADING5: 7,
  HEADING6: 8,
  BULLET: 12,
  ORDERED: 13,
  CODE: 14,
  QUOTE: 15,
  DIVIDER: 22,
} as const;

/**
 * 将 Markdown 文本解析为飞书文档 Block 数组
 * 支持：标题(#-######)、无序列表(-)、有序列表(1.)、代码块(```)、引用(>)、分割线(---)、普通文本
 */
function markdownToBlocks(markdown: string): any[] {
  const lines = markdown.split('\n');
  const blocks: any[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const content = codeLines.join('\n');
      if (content) {
        blocks.push({
          block_type: BLOCK_TYPE.CODE,
          code: {
            style: { language: langToCode(lang) },
            elements: [{ text_run: { content } }],
          },
        });
      }
      continue;
    }

    // 空行跳过
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 分割线
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      blocks.push({ block_type: BLOCK_TYPE.DIVIDER, divider: {} });
      i++;
      continue;
    }

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const blockType = BLOCK_TYPE.HEADING1 + level - 1;
      const headingKey = `heading${level}`;
      blocks.push({
        block_type: blockType,
        [headingKey]: { elements: parseInlineElements(text) },
      });
      i++;
      continue;
    }

    // 引用
    if (line.trimStart().startsWith('> ')) {
      const text = line.trimStart().slice(2);
      blocks.push({
        block_type: BLOCK_TYPE.QUOTE,
        quote: { elements: parseInlineElements(text) },
      });
      i++;
      continue;
    }

    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const text = line.replace(/^\s*[-*]\s+/, '');
      blocks.push({
        block_type: BLOCK_TYPE.BULLET,
        bullet: { elements: parseInlineElements(text) },
      });
      i++;
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const text = line.replace(/^\s*\d+\.\s+/, '');
      blocks.push({
        block_type: BLOCK_TYPE.ORDERED,
        ordered: { elements: parseInlineElements(text) },
      });
      i++;
      continue;
    }

    // 普通文本（合并连续非空行）
    const textLines: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('#') &&
      !lines[i].trimStart().startsWith('```') &&
      !lines[i].trimStart().startsWith('> ') &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^-{3,}$/.test(lines[i].trim())) {
      textLines.push(lines[i]);
      i++;
    }
    blocks.push({
      block_type: BLOCK_TYPE.TEXT,
      text: { elements: parseInlineElements(textLines.join('\n')) },
    });
  }

  return blocks;
}

/**
 * 解析行内元素：加粗(**text**)、行内代码(`code`)、普通文本
 */
function parseInlineElements(text: string): any[] {
  const elements: any[] = [];
  // 匹配 **bold**、`code`、普通文本
  const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)|([^*`]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      // 加粗
      elements.push({
        text_run: {
          content: match[2],
          text_element_style: { bold: true },
        },
      });
    } else if (match[4]) {
      // 行内代码
      elements.push({
        text_run: {
          content: match[4],
          text_element_style: { inline_code: true },
        },
      });
    } else if (match[5]) {
      elements.push({ text_run: { content: match[5] } });
    }
  }

  if (elements.length === 0) {
    elements.push({ text_run: { content: text } });
  }
  return elements;
}

/**
 * 语言名称转飞书代码块语言枚举值
 * 飞书 API 要求 language 值从 1 开始，不接受 0
 */
function langToCode(lang: string): number {
  const map: Record<string, number> = {
    plaintext: 1, text: 1,
    bash: 7, shell: 7, sh: 7,
    python: 17, py: 17,
    java: 12,
    javascript: 13, js: 13,
    typescript: 14, ts: 14,
    json: 16,
    yaml: 18, yml: 18,
    go: 9,
    rust: 19,
    sql: 20,
    markdown: 15, md: 15,
    html: 10,
    css: 8,
    xml: 24,
  };
  return map[lang.toLowerCase()] ?? 1; // 默认 PlainText = 1
}

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
 * 向飞书云文档写入 Markdown 内容
 * 将 Markdown 解析为飞书 Block 结构，追加到文档末尾
 * 
 * 飞书 API 限制每次最多创建 50 个 block，超过时自动分批写入
 */
export async function writeDocxContent(
  client: lark.Client,
  documentId: string,
  content: string
): Promise<{ blocksCreated: number }> {
  const blocks = markdownToBlocks(content);
  if (blocks.length === 0) {
    return { blocksCreated: 0 };
  }

  // 获取文档根 block（document_id 即为根 block_id）
  const BATCH_SIZE = 50;
  let totalCreated = 0;

  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const batch = blocks.slice(i, i + BATCH_SIZE);

    // 频率限制：3次/秒，批次间加延迟
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    const response = await client.docx.documentBlockChildren.create({
      path: {
        document_id: documentId,
        block_id: documentId, // 根 block
      },
      params: {
        document_revision_id: -1, // -1 表示使用最新版本
      },
      data: {
        children: batch,
        index: -1, // -1 表示追加到末尾
      },
    } as any);

    if (response.code !== 0) {
      throw new Error(`写入文档失败 (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${response.msg}`);
    }

    totalCreated += batch.length;
  }

  return { blocksCreated: totalCreated };
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
