import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { MermaidDiagram } from './MermaidDiagram';

const components: Components = {
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    if (!src) return null;
    return <img src={src} alt={alt ?? ''} loading="lazy" className="chat-md-img" />;
  },
  table({ children }) {
    return (
      <div className="chat-md-table-wrap">
        <table>{children}</table>
      </div>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children }) {
    const text = String(children ?? '');
    const lang = /language-(\S+)/.exec(className ?? '')?.[1];
    if (!lang && !text.includes('\n')) return <code className={className}>{children}</code>;
    const code = text.replace(/\n$/, '');
    if (lang === 'mermaid') return <MermaidDiagram source={code} />;
    return <CodeBlock code={code} language={lang} />;
  },
};

/** Renders assistant/chat markdown (GFM). Escapes raw HTML — no rehype-raw. */
export function ChatMarkdown({ content, className }: { content: string; className?: string }) {
  const trimmed = content.trim();
  if (!trimmed) return null;

  return (
    <div className={className ? `chat-md ${className}` : 'chat-md'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {trimmed}
      </ReactMarkdown>
    </div>
  );
}
