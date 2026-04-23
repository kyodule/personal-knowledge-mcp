/**
 * P0-1: Cross-encoder reranker. 懒加载单例，参考 utils/embedder.ts 的模式。
 * 模型默认 Xenova/bge-reranker-base（多语言双编码器，约 200MB）。
 * 失败时调用方应 fallback 到原始候选顺序——本模块自身不抛业务错。
 */
process.env.OMP_NUM_THREADS = '1';

const MODEL_NAME = 'Xenova/bge-reranker-base';
const MAX_PAIR_CHARS = 1800; // 约 512 token，留余量给 query

let pipelinePromise: Promise<any> | null = null;

async function getReranker(): Promise<any> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      // text-classification pipeline 跑 cross-encoder，input 是 [{text, text_pair}]
      return pipeline('text-classification', MODEL_NAME, { dtype: 'fp32', device: 'cpu' });
    })();
  }
  return pipelinePromise;
}

export interface RerankCandidate<T = any> {
  payload: T;
  text: string;
}

/**
 * 对候选列表按 (query, candidate.text) 相关性重排。
 * 返回与输入等长、按 score 降序排列的新数组（包含 score）。
 */
export async function rerank<T>(
  query: string,
  candidates: RerankCandidate<T>[]
): Promise<Array<{ payload: T; score: number }>> {
  if (candidates.length === 0) return [];
  const model = await getReranker();

  // bge-reranker 期望成对输入，transformers.js 接受 {text, text_pair} 数组
  const inputs = candidates.map((c) => ({
    text: query.slice(0, 256),
    text_pair: c.text.slice(0, MAX_PAIR_CHARS),
  }));

  const raw = await model(inputs);
  // 兼容两种返回：单条对象 或 [{label, score}, ...]
  const arr: any[] = Array.isArray(raw) ? raw : [raw];

  return candidates
    .map((c, i) => {
      const r = arr[i];
      // 取 score 字段；若 label 是负面相关性的，score 含义可能反，但 bge-reranker 输出的是 single logit，越大越相关
      const score = typeof r?.score === 'number' ? r.score : 0;
      return { payload: c.payload, score };
    })
    .sort((a, b) => b.score - a.score);
}

export async function warmupReranker(): Promise<void> {
  await getReranker();
}
