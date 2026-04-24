/**
 * P0-3: 近似重复页面检测。
 * 对指定路径前缀下的文档，用文档级 embedding 做 N×N 余弦比较，
 * 结合标题 bigram Jaccard 作为辅助信号，输出候选对及建议动作。
 */
import { KnowledgeDatabase } from '../storage/database.js';
import { cosine, embedDocsBatch, titleJaccard } from './common.js';

export interface LintDuplicateInput {
  /**
   * 路径模式，LIKE 语法，例如 "%/wiki/concepts/%"。
   * 注意：通配模式（%/wiki/concepts/%）会同时命中 logseq/bak 等备份目录，
   * 推荐传具体 vault 前缀，例如 "/Users/<you>/Documents/myob/wiki/concepts/%"。
   */
  pathLike: string;
  /** 语义相似度阈值，默认 0.85 */
  threshold?: number;
  /** 返回结果上限，默认 50 */
  limit?: number;
  /** 文档级 embedding 截断的字符数，默认 2000 */
  maxChars?: number;
}

export interface DuplicatePair {
  a: { id: string; title: string; source_id: string };
  b: { id: string; title: string; source_id: string };
  semanticSimilarity: number;
  titleJaccard: number;
  suggestedAction: 'merge' | 'review';
}

export interface LintDuplicatesResult {
  scanned: number;
  pairs: DuplicatePair[];
  hint: string;
}

export async function lintDuplicates(
  db: KnowledgeDatabase,
  input: LintDuplicateInput
): Promise<LintDuplicatesResult> {
  const threshold = input.threshold ?? 0.85;
  const limit = input.limit ?? 50;
  const maxChars = input.maxChars ?? 2000;

  const docs = db.getDocumentsByPathLike(input.pathLike);
  if (docs.length < 2) {
    return {
      scanned: docs.length,
      pairs: [],
      hint: `Only ${docs.length} document(s) matched "${input.pathLike}"; need at least 2 to compare.`,
    };
  }

  // Embed all docs at once (MiniLM-L6 is fast; hundreds of short pages = a few seconds)
  const vectors = await embedDocsBatch(
    docs.map((d) => `${d.title}\n\n${d.content}`),
    maxChars
  );

  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const sim = cosine(vectors[i], vectors[j]);
      if (sim < threshold) continue;
      const titleSim = titleJaccard(docs[i].title, docs[j].title);
      pairs.push({
        a: { id: docs[i].id, title: docs[i].title, source_id: docs[i].source_id },
        b: { id: docs[j].id, title: docs[j].title, source_id: docs[j].source_id },
        semanticSimilarity: Number(sim.toFixed(4)),
        titleJaccard: Number(titleSim.toFixed(4)),
        // 两个信号都强 => 建议合并；仅语义强 => 留人审
        suggestedAction: sim >= 0.92 || titleSim >= 0.6 ? 'merge' : 'review',
      });
    }
  }

  pairs.sort((x, y) => y.semanticSimilarity - x.semanticSimilarity);

  return {
    scanned: docs.length,
    pairs: pairs.slice(0, limit),
    hint:
      pairs.length === 0
        ? `No pairs above threshold ${threshold}. Try lowering threshold or widen pathLike.`
        : `Found ${pairs.length} candidate pair(s); top ${Math.min(limit, pairs.length)} returned.`,
  };
}
