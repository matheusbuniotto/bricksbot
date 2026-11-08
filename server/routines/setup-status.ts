import type { ChatClient } from '../../shared/agents/types.js';
import { resolveLlmEnv } from '../agents/clients/resolve-llm-env.js';
import { presentEnv } from '../lib/env.js';

export interface SetupStatus {
  provider: ChatClient['provider'];
  needsLlmSetup: boolean;
  lakebaseConfigured: boolean;
  secretsScope: string;
  secretKeys: string[];
  servingHint: string;
  putSecretExamples: string[];
  /** From BRICKSBOT_PUBLIC_APP_URL when set (optional; UI may use window.location). */
  appPublicUrl: string | null;
  /** CLI examples for routine webhook secret — never includes a real secret value. */
  routineWebhookSecretPutExample: string[];
}

/** Build install-wizard status from env + resolved ChatClient (no invented secrets). */
export function buildSetupStatus(
  env: Record<string, string | undefined>,
  provider: ChatClient['provider']
): SetupStatus {
  const resolved = resolveLlmEnv(env);
  const scope = env.LLM_SECRET_SCOPE?.trim() || 'bricksbot';
  const secretKey = env.LLM_SECRET_KEY?.trim() || 'openrouter-api-key';
  const lakebaseConfigured = Boolean(env.LAKEBASE_ENDPOINT || env.PGHOST);
  const hasOpenAI = Boolean(presentEnv(resolved.LLM_BASE_URL) && presentEnv(resolved.LLM_API_KEY));
  const needsLlmSetup = provider === 'stub' || (!hasOpenAI && provider !== 'databricks-serving');

  const appPublicUrl = env.BRICKSBOT_PUBLIC_APP_URL?.trim() || null;
  const routineWebhookScope = env.ROUTINE_WEBHOOK_SECRET_SCOPE?.trim() || 'bricksbot';
  const routineWebhookKey = env.ROUTINE_WEBHOOK_SECRET_KEY?.trim() || 'routine-webhook-key';

  return {
    provider,
    needsLlmSetup,
    lakebaseConfigured,
    secretsScope: scope,
    secretKeys: [secretKey],
    servingHint:
      'To use Databricks Model Serving later, bind a serving-endpoint resource and set LLM_PROVIDER=databricks (see app.yaml comments).',
    putSecretExamples: [
      `# Scope \`${scope}\`, secret \`${secretKey}\``,
      `databricks secrets put-secret ${scope} ${secretKey} --string-value 'YOUR_KEY' -p dev`,
      `# Optional local override: LLM_BASE_URL + LLM_MODEL in .env (defaults to OpenRouter)`,
    ],
    appPublicUrl,
    routineWebhookSecretPutExample: [
      `# After creating a routine in the App, store its one-time webhook secret`,
      `databricks secrets put-secret ${routineWebhookScope} ${routineWebhookKey} --string-value 'YOUR_WEBHOOK_SECRET' -p dev`,
      `# Set bundle variables routine_webhook_app_base_url + routine_webhook_routine_id, then bundle deploy`,
    ],
  };
}
