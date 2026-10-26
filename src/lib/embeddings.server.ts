const EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-large";
const MAX_BATCH = 100;

/** Split raw document text into overlapping chunks suitable for embedding. */
export function chunkText(raw: string, size = 1200, overlap = 150): string[] {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    let slice = text.slice(start, end);
    if (end < text.length) {
      const breakAt = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("\n"));
      if (breakAt > size * 0.5) slice = slice.slice(0, breakAt + 1);
    }
    const trimmed = slice.trim();
    if (trimmed) chunks.push(trimmed);
    start += Math.max(1, slice.length - overlap);
  }
  return chunks;
}

/** Embed every input through the OpenAI embeddings API, batching within provider limits. */
export async function embedTexts(inputs: string[]): Promise<number[][]> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured for this project yet.");

  const vectors: number[][] = [];
  for (let i = 0; i < inputs.length; i += MAX_BATCH) {
    const batch = inputs.slice(i, i + MAX_BATCH);
    const response = await fetch(EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, input: batch }),
    });

    if (response.status === 429) {
      throw new Error("Too many requests right now — please try again in a moment.");
    }
    if (response.status === 402) {
      throw new Error("AI credits are exhausted. Add credits to keep indexing documents.");
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Could not index this document (${response.status}). ${detail.slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as {
      data: { index: number; embedding: number[] }[];
    };
    const ordered = [...payload.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) vectors.push(item.embedding);
  }
  return vectors;
}
