export const MAX_MERMAID_CHARS = 16_000;

const ALLOWED_TYPES = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'stateDiagram',
  'classDiagram',
  'erDiagram',
];

export type MermaidCheck = { ok: true } | { ok: false; error: string };

export function validateMermaidSource(source: string): MermaidCheck {
  const text = source.trim();
  if (!text) return { ok: false, error: 'mermaid source is empty' };
  if (text.length > MAX_MERMAID_CHARS) {
    return { ok: false, error: `mermaid source is too long (max ${MAX_MERMAID_CHARS} chars)` };
  }
  if (/%%\{/.test(text)) {
    return { ok: false, error: 'mermaid init directives are not allowed' };
  }
  if (/^\s*click\s/m.test(text)) {
    return { ok: false, error: 'mermaid click handlers are not allowed' };
  }
  const first = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('%%'));
  const ok = first && ALLOWED_TYPES.some((type) => first === type || first.startsWith(`${type} `) || first.startsWith(`${type}-`));
  if (!ok) return { ok: false, error: `mermaid diagram type must be one of: ${ALLOWED_TYPES.join(', ')}` };
  return { ok: true };
}
