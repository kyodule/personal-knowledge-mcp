import fs from 'fs/promises';
import path from 'path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import AdmZip from 'adm-zip';
import { parseString } from 'xml2js';

/**
 * 文件解析器
 * 负责将不同格式的文件转换为纯文本
 */
export class FileParser {
  /**
   * 根据文件扩展名解析文件内容
   * @param filePath 文件路径
   * @returns 文件文本内容
   */
  async parseFile(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();

    try {
      switch (ext) {
        case '.txt':
        case '.md':
          return await this.parseText(filePath);
        case '.pdf':
          return await this.parsePDF(filePath);
        case '.docx':
          return await this.parseDOCX(filePath);
        case '.pptx':
          return await this.parsePPTX(filePath);
        default:
          // 尝试作为纯文本读取
          return await this.parseText(filePath);
      }
    } catch (error) {
      throw new Error(`解析文件失败 ${filePath}: ${error}`);
    }
  }

  /**
   * 解析纯文本文件
   * @param filePath 文件路径
   * @returns 文本内容
   */
  private async parseText(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    return buffer.toString('utf-8');
  }

  /**
   * 解析 PDF 文件
   * @param filePath 文件路径
   * @returns 提取的文本内容
   */
  private async parsePDF(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }

  /**
   * 解析 DOCX 文件
   * @param filePath 文件路径
   * @returns 转换为 Markdown 的文本内容
   */
  private async parseDOCX(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    // mammoth 没有 convertToMarkdown，使用 convertToHtml 然后提取文本
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  /**
   * 解析 PPTX 文件
   * @param filePath 文件路径
   * @returns 提取的文本内容
   */
  private async parsePPTX(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    const textContents: string[] = [];

    // PPTX 结构：ppt/slides/slide*.xml 包含幻灯片内容
    for (const entry of zipEntries) {
      if (entry.entryName.match(/ppt\/slides\/slide\d+\.xml/)) {
        const xml = entry.getData().toString('utf8');
        const text = await this.extractTextFromSlideXML(xml);
        if (text.trim()) {
          textContents.push(text);
        }
      }
    }

    return textContents.join('\n\n---\n\n');
  }

  /**
   * 从幻灯片 XML 中提取文本
   * @param xml XML 字符串
   * @returns 提取的文本
   */
  private async extractTextFromSlideXML(xml: string): Promise<string> {
    return new Promise((resolve, reject) => {
      parseString(xml, (err, result) => {
        if (err) {
          reject(err);
          return;
        }

        const texts: string[] = [];

        // 递归提取所有 <a:t> 标签的内容（文本节点）
        const extractText = (obj: any) => {
          if (!obj) return;

          if (typeof obj === 'object') {
            // 如果是 <a:t> 标签，提取文本
            if (obj['a:t']) {
              const textArray = obj['a:t'];
              if (Array.isArray(textArray)) {
                textArray.forEach((item: any) => {
                  if (typeof item === 'string') {
                    texts.push(item);
                  } else if (item._) {
                    texts.push(item._);
                  }
                });
              }
            }

            // 递归处理所有子对象
            Object.values(obj).forEach(value => {
              if (typeof value === 'object') {
                extractText(value);
              }
            });
          }
        };

        extractText(result);
        resolve(texts.join(' '));
      });
    });
  }

  /**
   * 提取文件标题
   * @param filePath 文件路径
   * @param content 文件内容
   * @returns 文件标题
   */
  extractTitle(filePath: string, content: string): string {
    // 优先使用文件名
    const fileName = path.basename(filePath, path.extname(filePath));

    // 如果是 Markdown，尝试提取一级标题
    if (path.extname(filePath) === '.md') {
      const match = content.match(/^#\s+(.+)$/m);
      if (match) {
        return match[1].trim();
      }
    }

    // 如果是 PPTX，尝试提取第一行作为标题
    if (path.extname(filePath) === '.pptx') {
      const firstLine = content.split('\n')[0];
      if (firstLine && firstLine.length > 0 && firstLine.length < 100) {
        return firstLine.trim();
      }
    }

    return fileName;
  }
}
