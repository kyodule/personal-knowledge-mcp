// Fix onnxruntime-node mutex crash on Node.js v24+
// Must be set before onnxruntime native library loads
process.env.OMP_NUM_THREADS = '1';

export const EMBEDDING_DIM = 384;
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

let extractorPromise: Promise<any> | null = null;

async function getExtractor(): Promise<any> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      return pipeline('feature-extraction', MODEL_NAME, { dtype: 'fp32', device: 'cpu' });
    })();
  }
  return extractorPromise;
}

export async function embed(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const result = await extractor(text, { pooling: 'mean', normalize: true });
  return new Float32Array(result.data as Float64Array);
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const result = await extractor(texts, { pooling: 'mean', normalize: true });
  const data = new Float32Array(result.data as ArrayLike<number>);
  const results: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(data.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM));
  }
  return results;
}

export function vecToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export async function warmup(): Promise<void> {
  await getExtractor();
}
