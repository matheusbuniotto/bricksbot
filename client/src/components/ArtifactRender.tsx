import { useEffect, useRef, useState } from 'react';
import type { ArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice';
import { CodeBlock } from './CodeBlock';
import { MermaidDiagram } from './MermaidDiagram';
import {
  parseChartBody,
  parseTableBody,
  parseVegaBody,
  type ChartData,
  type VegaSpec,
} from '../lib/artifact-render';

const W = 480;
const H = 160;
const PAD = 24;

function Chart({ data }: { data: ChartData }) {
  const max = Math.max(...data.y, 0) || 1;
  const min = Math.min(...data.y, 0);
  const span = max - min || 1;
  const step = (W - PAD * 2) / data.y.length;
  const yOf = (n: number) => H - PAD - ((n - min) / span) * (H - PAD * 2);
  const xOf = (i: number) => PAD + step * i + step / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="artifact-chart" role="img">
      <line x1={PAD} x2={W - PAD} y1={yOf(0)} y2={yOf(0)} stroke="currentColor" opacity={0.3} />
      {data.type === 'bar' ? (
        data.y.map((n, i) => (
          <rect
            key={i}
            x={xOf(i) - step * 0.35}
            width={step * 0.7}
            y={Math.min(yOf(n), yOf(0))}
            height={Math.abs(yOf(n) - yOf(0))}
            fill="currentColor"
            opacity={0.75}
          >
            <title>{`${data.x[i]}: ${n}`}</title>
          </rect>
        ))
      ) : (
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          points={data.y.map((n, i) => `${xOf(i)},${yOf(n)}`).join(' ')}
        />
      )}
      {data.x.map((label, i) => (
        <text key={i} x={xOf(i)} y={H - 6} fontSize={9} textAnchor="middle" fill="currentColor">
          {label.length > 8 ? `${label.slice(0, 7)}…` : label}
        </text>
      ))}
    </svg>
  );
}

function VegaChart({ spec }: { spec: VegaSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let view: { finalize(): void } | undefined;
    let cancelled = false;
    void import('vega-embed')
      .then(({ default: embed }) =>
        embed(ref.current!, { width: 440, ...spec, background: 'transparent' } as never, {
          actions: { export: true, source: false, compiled: false, editor: false },
          renderer: 'svg',
        }),
      )
      .then((result) => {
        if (cancelled) result.finalize();
        else view = result;
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      view?.finalize();
    };
  }, [spec]);

  if (failed) return <pre className="artifact-fallback">{JSON.stringify(spec, null, 2)}</pre>;
  return <div ref={ref} className="artifact-vega" />;
}

export function ArtifactRender({ notice }: { notice: ArtifactPinNotice }) {
  if (notice.artifactKind === 'mermaid') return <MermaidDiagram source={notice.body} />;
  if (notice.artifactKind === 'sql') return <CodeBlock code={notice.body} language="sql" />;
  if (notice.artifactKind === 'table') {
    const table = parseTableBody(notice.body);
    if (!table) return <pre className="artifact-fallback">{notice.body}</pre>;
    return (
      <div className="artifact-table-wrap">
        <table className="artifact-table">
          <thead>
            <tr>
              {table.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell === null ? '' : String(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (notice.artifactKind === 'chart') {
    const vega = parseVegaBody(notice.body);
    if (vega) return <VegaChart spec={vega} />;
    const chart = parseChartBody(notice.body);
    return chart ? <Chart data={chart} /> : <pre className="artifact-fallback">{notice.body}</pre>;
  }
  return null;
}
