/** Splits text into overlapping chunks on paragraph, then sentence, then word boundaries. */
export interface ChunkOptions {
  /** Target size in characters. */
  size?: number;
  /** Characters repeated from the end of one chunk at the start of the next. */
  overlap?: number;
  maxChunks?: number;
}

function hardSplit(piece: string, size: number): string[] {
  const out: string[] = [];
  let rest = piece;
  while (rest.length > size) {
    const window = rest.slice(0, size);
    const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'));
    const space = window.lastIndexOf(' ');
    const cut = sentence > size / 2 ? sentence + 1 : space > size / 2 ? space : size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

export function chunkText(raw: string, options: ChunkOptions = {}): string[] {
  const size = options.size ?? 1200;
  const overlap = Math.min(options.overlap ?? 200, Math.floor(size / 2));
  const maxChunks = options.maxChunks ?? 2000;
  const text = raw.replace(/\r\n?/g, '\n').split('\0').join('');
  const pieces = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => (paragraph.length > size ? hardSplit(paragraph, size) : [paragraph]));

  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > size) {
      chunks.push(current);
      if (chunks.length >= maxChunks) return chunks;
      const tail = current.slice(-overlap);
      const boundary = tail.indexOf(' ');
      current = overlap > 0 ? `${(boundary >= 0 ? tail.slice(boundary + 1) : tail).trim()}\n\n${piece}` : piece;
      if (current.length > size) current = piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current.trim() && chunks.length < maxChunks) chunks.push(current);
  return chunks;
}
