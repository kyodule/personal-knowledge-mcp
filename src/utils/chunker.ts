export interface Chunk {
  index: number;
  text: string;
}

const TARGET_CHUNK_SIZE = 1500;
const MIN_CHUNK_SIZE = 200;

/**
 * 将文档内容按段落/章节切分为 chunks。
 * 策略：先按 Markdown 标题或连续空行分段，再合并过短的段落，拆分过长的段落。
 */
export function chunkDocument(content: string): Chunk[] {
  if (content.length <= TARGET_CHUNK_SIZE) {
    return [{ index: 0, text: content }];
  }

  const sections = splitBySections(content);
  const merged = mergeSections(sections);
  return merged.map((text, index) => ({ index, text }));
}

/**
 * 按 Markdown 标题 / 连续空行 / PPT 分隔线拆分
 */
function splitBySections(content: string): string[] {
  // 按 Markdown 标题（## / ### 等）或连续两个换行分段
  const parts = content.split(/(?=^#{1,4}\s)/m);

  const sections: string[] = [];
  for (const part of parts) {
    // 再按连续空行拆
    const subParts = part.split(/\n{3,}/);
    for (const sub of subParts) {
      const trimmed = sub.trim();
      if (trimmed) {
        sections.push(trimmed);
      }
    }
  }
  return sections;
}

/**
 * 合并过短的段落，拆分过长的段落
 */
function mergeSections(sections: string[]): string[] {
  const result: string[] = [];
  let buffer = '';

  for (const section of sections) {
    if (section.length > TARGET_CHUNK_SIZE * 2) {
      // 先 flush buffer
      if (buffer) {
        result.push(buffer);
        buffer = '';
      }
      // 按段落拆分过长的 section
      const paragraphs = section.split(/\n{2,}/);
      let longBuffer = '';
      for (const para of paragraphs) {
        if (longBuffer.length + para.length + 1 > TARGET_CHUNK_SIZE && longBuffer.length >= MIN_CHUNK_SIZE) {
          result.push(longBuffer);
          longBuffer = para;
        } else {
          longBuffer = longBuffer ? longBuffer + '\n\n' + para : para;
        }
      }
      if (longBuffer) {
        result.push(longBuffer);
      }
    } else if (buffer.length + section.length + 2 > TARGET_CHUNK_SIZE && buffer.length >= MIN_CHUNK_SIZE) {
      result.push(buffer);
      buffer = section;
    } else {
      buffer = buffer ? buffer + '\n\n' + section : section;
    }
  }

  if (buffer) {
    result.push(buffer);
  }

  return result;
}
