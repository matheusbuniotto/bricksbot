import { useEffect, useId, useRef, useState } from 'react';
import { validateMermaidSource } from '../../../shared/chat/mermaid-source';
import { useIsDarkTheme } from '../lib/use-is-dark-theme';
import { CodeBlock } from './CodeBlock';

export function MermaidDiagram({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const dark = useIsDarkTheme();
  const [error, setError] = useState<string | null>(() => {
    const checked = validateMermaidSource(source);
    return checked.ok ? null : checked.error;
  });

  useEffect(() => {
    if (error) return;
    let cancelled = false;
    const renderId = `mmd-${baseId}-${dark ? 'd' : 'l'}`;
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dark ? 'dark' : 'default',
        });
        const { svg } = await mermaid.render(renderId, source.trim());
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      })
      .catch((err: unknown) => {
        document.getElementById(`d${renderId}`)?.remove();
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not render diagram');
      });
    return () => {
      cancelled = true;
    };
  }, [source, baseId, dark, error]);

  if (error) {
    return (
      <div>
        <CodeBlock code={source} language="mermaid" />
        <div className="artifact-caption">{error}</div>
      </div>
    );
  }
  return <div ref={ref} className="artifact-mermaid" />;
}
