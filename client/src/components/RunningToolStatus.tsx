import { useEffect, useState } from 'react';

function formatElapsed(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Live “accepted / running” strip while a long approved tool is in flight. */
export function RunningToolStatus({
  label,
  startedAt,
}: {
  label: string;
  startedAt: string;
}) {
  const [elapsedSec, setElapsedSec] = useState(() => {
    const started = Date.parse(startedAt);
    if (!Number.isFinite(started)) return 0;
    return Math.max(0, Math.floor((Date.now() - started) / 1000));
  });

  useEffect(() => {
    const started = Date.parse(startedAt);
    if (!Number.isFinite(started)) return;
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <div className="running-tool" role="status" aria-live="polite" aria-atomic="true">
      <span className="running-tool-pulse" aria-hidden />
      <div className="running-tool-copy">
        <span className="running-tool-accepted">Accepted</span>
        <span className="running-tool-label">Running {label}…</span>
      </div>
      <span className="running-tool-elapsed" title="Elapsed">
        {formatElapsed(elapsedSec)}
      </span>
    </div>
  );
}
