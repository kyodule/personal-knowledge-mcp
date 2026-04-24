/**
 * 检索相关公共工具：向量运算 + 文档级 embedding 辅助。
 * P0-1 / P0-2 / P0-3 共用。
 */
import { embedBatch, EMBEDDING_DIM } from '../utils/embedder.js';

/**
 * 余弦相似度。输入向量默认已 L2 normalize（embedder.ts 用 normalize:true），
 * 所以等价于点积，但这里仍显式除以范数以容错。
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dim mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * 对一批 Float32Array 做 mean pooling，返回 L2-normalized 平均向量。
 */
export function meanPool(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) return new Float32Array(EMBEDDING_DIM);
  const dim = vectors[0].length;
  const out = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}

/**
 * 文档级 embedding：对 content 截断后直接 embed，不依赖 chunks_vec。
 * 对 concept/entity 类短页面足够；对长文档精度略损失但 P0-3 去重够用。
 */
export async function embedDocsBatch(
  contents: string[],
  maxChars: number = 2000
): Promise<Float32Array[]> {
  const truncated = contents.map((c) => c.substring(0, maxChars));
  return embedBatch(truncated);
}

/**
 * 简易 Jaccard on char bigrams（中文友好，不依赖 jieba），用于标题近似度辅助信号。
 */
export function titleJaccard(a: string, b: string): number {
  const bigrams = (s: string) => {
    const t = s.replace(/\s+/g, '').toLowerCase();
    const set = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const sa = bigrams(a), sb = bigrams(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  return inter / (sa.size + sb.size - inter);
}
