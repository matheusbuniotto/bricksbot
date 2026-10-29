import type { ChatClient } from '../../shared/llm/types.js';
import { resolveLlmEnv } from '../llm/resolve-llm-env.js';

export interface SetupStatus {
  provider: ChatClient['provider'];
  needsLlmSetup: boolean;
  lakebaseConfigured: boolean;
  secretsScope: string;
  secretKeys: string[];
  servingHint: string;
  putSecretExamples: string[];
}

function truthySecret(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed !== '__UNSET__';
}

/** Build install-wizard status from env + resolved ChatClient (no invented secrets). */
export function buildSetupStatus(
  env: Record<string, string | undefined>,
  provider: ChatClient['provider'],
): SetupStatus {
  const resolved = resolveLlmEnv(env);
  const scope = env.LLM_SECRET_SCOPE?.trim() || 'claw';
  const secretKey = env.LLM_SECRET_KEY?.trim() || 'openrouter-api-key';
  const lakebaseConfigured = Boolean(env.LAKEBASE_ENDPOINT || env.PGHOST);
  const hasOpenAI =
    truthySecret(resolved.LLM_BASE_URL) && truthySecret(resolved.LLM_API_KEY);
  const needsLlmSetup =
    provider === 'stub' || (!hasOpenAI && provider !== 'databricks-serving');

  return {
    provider,
    needsLlmSetup,
    lakebaseConfigured,
    secretsScope: scope,
    secretKeys: [secretKey],
    servingHint:
      'To use Databricks Model Serving later, bind a serving-endpoint resource and set LLM_PROVIDER=databricks (see app.yaml comments).',
    putSecretExamples: [
      `# Same key as clawhouse — scope \`${scope}\`, secret \`${secretKey}\``,
      `databricks secrets put-secret ${scope} ${secretKey} --string-value 'YOUR_KEY' -p dev`,
      `# Optional local override: LLM_BASE_URL + LLM_MODEL in .env (defaults match clawhouse OpenRouter)`,
    ],
  };
}
