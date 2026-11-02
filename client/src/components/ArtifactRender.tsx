import { useEffect, useRef, useState } from 'react';
import type { ArtifactPinNotice } from '../../../shared/chat/artifact-pin-notice';
import { CodeBlock } from './CodeBlock';
import { MermaidDiagram } from './MermaidDiagram';
import { parseChartBody, parseTableBody, parseVegaBody, type ChartData, type VegaSpec } from '../lib/artifact-render';
import { useIsDarkTheme } from '../lib/use-is-dark-theme';

const W = 480;
const H = 160;
const PAD = 24;

const DARK_VEGA_CONFIG = {
  background: 'transparent',
  view: { stroke: 'rgba(255,255,255,0.12)' },
  axis: {
    domainColor: 'rgba(255,255,255,0.28)',
    gridColor: 'rgba(255,255,255,0.10)',
    tickColor: 'rgba(255,255,255,0.28)',
    labelColor: '#e6e4de',
    titleColor: '#f3f1ec',
  },
  legend: {
    labelColor: '#e6e4de',
    titleColor: '#f3f1ec',
  },
  header: {
    labelColor: '#e6e4de',
    titleColor: '#f3f1ec',
  },
  title: {
    color: '#f3f1ec',
    subtitleColor: '#b8b4aa',
  },
  text: { fill: '#e6e4de' },
  rule: { stroke: '#e6e4de' },
  range: {
    category: ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#38bdf8'],
  },
};

const LIGHT_VEGA_CONFIG = {
  background: 'transparent',
  view: { stroke: 'rgba(0,0,0,0.08)' },
  axis: {
    domainColor: 'rgba(0,0,0,0.25)',
    gridColor: 'rgba(0,0,0,0.07)',
    tickColor: 'rgba(0,0,0,0.25)',
    labelColor: '#2b2b2b',
    titleColor: '#171717',
  },
  legend: {
    labelColor: '#2b2b2b',
    titleColor: '#171717',
  },
  header: {
    labelColor: '#2b2b2b',
    titleColor: '#171717',
  },
  title: {
    color: '#171717',
    subtitleColor: '#666666',
  },
  text: { fill: '#2b2b2b' },
  rule: { stroke: '#2b2b2b' },
  range: {
    category: ['#2563eb', '#059669', '#d97706', '#db2777', '#7c3aed', '#ea580c', '#0284c7'],
  },
};

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
  const dark = useIsDarkTheme();

  useEffect(() => {
    let view: { finalize(): void } | undefined;
    let cancelled = false;
    const baseConfig = dark ? DARK_VEGA_CONFIG : LIGHT_VEGA_CONFIG;
    const userConfig =
      spec.config && typeof spec.config === 'object' && !Array.isArray(spec.config)
        ? (spec.config as Record<string, unknown>)
        : {};
    const themedSpec = {
      width: 440,
      ...spec,
      background: 'transparent',
      config: { ...baseConfig, ...userConfig },
    };
    void import('vega-embed')
      .then(({ default: embed }) =>
        embed(ref.current!, themedSpec as never, {
          actions: { export: true, source: false, compiled: false, editor: false },
          renderer: 'svg',
          theme: dark ? 'dark' : undefined,
          tooltip: { theme: dark ? 'dark' : 'light' },
        })
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
  }, [spec, dark]);

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
