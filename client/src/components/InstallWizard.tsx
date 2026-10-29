import { Button } from '@databricks/appkit-ui/react';
import type { SetupStatus } from '../lib/routines-api';

export function InstallWizard({
  status,
  dismissed,
  onDismiss,
  onOpen,
}: {
  status: SetupStatus | null;
  dismissed: boolean;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  if (!status) return null;

  if (dismissed && !status.needsLlmSetup) {
    return null;
  }

  if (dismissed) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
      >
        Setup
      </button>
    );
  }

  return (
    <div className="border-b border-border/80 bg-muted/30 px-4 md:px-6 py-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Install setup</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Provider <span className="font-mono">{status.provider}</span>
            {status.needsLlmSetup ? ' · stub LLM (set secrets to go live)' : ' · LLM configured'}
            {' · '}
            Lakebase {status.lakebaseConfigured ? 'connected' : 'in-memory fallback'}
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>

      {status.needsLlmSetup ? (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">
            Put OpenAI-compatible secrets in scope{' '}
            <span className="font-mono">{status.secretsScope}</span> (
            {status.secretKeys.join(', ')}). Do not paste real keys into the App.
          </p>
          <pre className="rounded-md border border-border/80 bg-background p-3 overflow-x-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {status.putSecretExamples.join('\n')}
          </pre>
          <p className="text-muted-foreground">{status.servingHint}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          LLM is ready. Redeploy after rotating secrets. Serving remains optional via app.yaml.
        </p>
      )}
    </div>
  );
}
