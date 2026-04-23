/**
 * P0-2: 查找已有 concept/entity 页面的近似匹配。
 * 用于 Ingest 流程：抽取候选概念后，先调本工具看是否已有同物页面，
 * 命中则走"合并/补充"分支，否则新建。
 */
import { KnowledgeDatabase } from '../storage/database.js';
import { titleJaccard } from './common.js';
import type { SearchResult } from '../types.js';

export interface FindSimilarPagesInput {
  /** 候选名称 + 可选短描述，用于 hybrid 检索 */
  text: string;
  /** "concept" 或 "entity"，决定默认 path_like */
  kind: 'concept' | 'entity';
  /** 自定义 path_like 模式，传入则覆盖 kind 的默认值 */
  path_like?: string;
  top_k?: number;
  /** 是否启用 cross-encoder rerank（默认 false，避免首次模型下载阻塞） */
  rerank?: boolean;
  /** 备选 title 用于 bigram 比较（通常等于 text 的纯名称部分） */
  candidate_title?: string;
}

export interface SimilarPage {
  id: string;
  title: string;
  source_id: string;
  snippet: string;
  semantic_rank: number;
  title_jaccard: number;
  /** "merge" / "review" / "distinct" 的建议 */
  suggested_action: 'merge' | 'review' | 'distinct';
  reasons: string[];
}

const DEFAULT_PATH_LIKE: Record<'concept' | 'entity', string> = {
  concept: '%/wiki/concepts/%',
  entity: '%/wiki/entities/%',
};

export async function findSimilarPages(
  db: KnowledgeDatabase,
  input: FindSimilarPagesInput,
  searchFn: (query: string, filters: any, limit: number, queryEmbedding?: Buffer) => SearchResult[],
  embedQuery: (text: string) => Promise<Buffer | undefined>,
  rerankFn?: (query: string, candidates: Array<{ payload: SearchResult; text: string }>) => Promise<Array<{ payload: SearchResult; score: number }>>
): Promise<{ matches: SimilarPage[]; hint: string }> {
  const top_k = input.top_k ?? 5;
  const path_like = input.path_like ?? DEFAULT_PATH_LIKE[input.kind];
  const candidateTitle = input.candidate_title ?? input.text;

  const queryEmbedding = await embedQuery(input.text);
  // 多召回，留出 rerank 与去重空间
  const pool = Math.max(top_k * 4, 20);
  const candidates = searchFn(input.text, { source: 'local', path_like }, pool, queryEmbedding);

  if (candidates.length === 0) {
    return { matches: [], hint: `No existing ${input.kind} pages matched. Safe to create new.` };
  }

  let ranked = candidates;
  if (input.rerank && rerankFn) {
    try {
      const rr = await rerankFn(
        input.text,
        candidates.map((c) => ({ payload: c, text: `${c.title}\n${c.snippet}` }))
      );
      ranked = rr.map((x) => x.payload);
    } catch { /* fallback to hybrid order */ }
  }

  // 标注 title jaccard，组合判定 suggested_action
  const annotated: SimilarPage[] = ranked.map((r, idx) => {
    const tj = titleJaccard(candidateTitle, r.title);
    const reasons: string[] = [];
    if (idx < 3) reasons.push('top hybrid hit');
    if (tj >= 0.6) reasons.push(`title bigram Jaccard ${tj.toFixed(2)}`);
    let action: SimilarPage['suggested_action'] = 'distinct';
    // rule: title 高度相似 → merge；topK 内但 title 不相似 → review
    if (tj >= 0.7) action = 'merge';
    else if (idx < top_k && (tj >= 0.4 || idx < 2)) action = 'review';
    return {
      id: r.id,
      title: r.title,
      source_id: r.source_id,
      snippet: r.snippet,
      semantic_rank: Number(r.rank.toFixed(4)),
      title_jaccard: Number(tj.toFixed(4)),
      suggested_action: action,
      reasons,
    };
  });

  const matches = annotated.slice(0, top_k);
  const merge = matches.filter((m) => m.suggested_action === 'merge').length;
  const review = matches.filter((m) => m.suggested_action === 'review').length;
  const hint =
    merge > 0
      ? `Found ${merge} likely merge candidate(s); recommend appending to existing page.`
      : review > 0
        ? `Found ${review} candidate(s) for human review; new page may still be appropriate.`
        : 'No strong overlap; safe to create new page.';

  return { matches, hint };
}
