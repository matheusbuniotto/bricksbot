import { useEffect, useState } from 'react';

const LANGS: Record<string, () => Promise<{ default: unknown }>> = {
  sql: () => import('highlight.js/lib/languages/sql'),
  python: () => import('highlight.js/lib/languages/python'),
  json: () => import('highlight.js/lib/languages/json'),
  bash: () => import('highlight.js/lib/languages/bash'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
};

const ALIASES: Record<string, string> = { py: 'python', sh: 'bash', shell: 'bash', ts: 'typescript', yml: 'yaml' };

export function normalizeLang(raw: string | undefined): string {
  const lang = (raw ?? '').toLowerCase().trim();
  return ALIASES[lang] ?? (lang || 'text');
}

async function highlight(code: string, lang: string): Promise<string | null> {
  const load = LANGS[lang];
  if (!load) return null;
  const [{ default: hljs }, mod] = await Promise.all([import('highlight.js/lib/core'), load()]);
  if (!hljs.getLanguage(lang)) hljs.registerLanguage(lang, mod.default as never);
  return hljs.highlight(code, { language: lang }).value;
}

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const lang = normalizeLang(language);
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    void highlight(code, lang)
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>{lang}</span>
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        {html === null ? <code>{code}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />}
      </pre>
    </div>
  );
}
