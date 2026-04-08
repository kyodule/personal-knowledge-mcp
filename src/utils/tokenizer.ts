import { createRequire } from 'module';
import { Jieba } from '@node-rs/jieba';

const require = createRequire(import.meta.url);
const { dict } = require('@node-rs/jieba/dict');

const jieba = Jieba.withDict(Buffer.from(dict));

const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

/**
 * 对文本进行中文分词，返回空格分隔的 token 字符串。
 * 使用 cutForSearch 获得细粒度分词，与查询侧保持一致，提高召回率。
 * 非 CJK 文本原样保留（FTS5 默认 tokenizer 对英文/数字工作良好）。
 */
export function tokenize(text: string): string {
  if (!CJK_RANGE.test(text)) {
    return text;
  }
  const words = jieba.cutForSearch(text, true);
  return words.join(' ');
}

/**
 * 对搜索 query 进行分词，用于 FTS5 MATCH。
 * 使用 cutForSearch 获得更细粒度的分词结果，提高召回率。
 */
export function tokenizeQuery(query: string): string {
  if (!CJK_RANGE.test(query)) {
    return query;
  }
  const words = jieba.cutForSearch(query, true);
  return words.filter((w: string) => w.trim().length > 0).join(' ');
}
