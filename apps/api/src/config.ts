import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load the repo-root .env regardless of the process cwd. Anchored to this file so
// it works under tsx (dev), vitest, and compiled output alike.
const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(apiDir, '..', '..');
dotenv.config({ path: resolve(repoRoot, '.env') });

const configSchema = z.object({
  yahooClientId: z.string().min(1),
  yahooClientSecret: z.string().min(1),
  yahooRedirectUri: z.string().url(),
  webAppUrl: z.string().url(),
  sessionSecret: z.string().min(16),
  port: z.coerce.number().int().positive(),
  /**
   * Base64-encoded 32-byte key that encrypts persisted Yahoo tokens at rest
   * (AES-256-GCM). Required by the local file-backed store; omitted in production,
   * which currently keeps tokens in memory. Never logged.
   */
  tokenEncKey: z.string().min(1).optional(),
  /**
   * Refresh a session's access token this many seconds before it expires, so the
   * refresh happens off the request hot path rather than as a mid-request 401 retry.
   */
  tokenRefreshSkewSeconds: z.coerce.number().int().nonnegative().default(300),
  /**
   * Data source for authed Yahoo data. 'live' calls the real Yahoo Fantasy API;
   * 'mock' serves fixture data through the same DTOs. Auth (Yahoo OAuth) is always
   * enforced regardless - only the data boundary changes.
   */
  dataMode: z.enum(['live', 'mock']).default('live'),
  /**
   * Source for per-window PLAYER stat values. 'yahoo' (default) uses Yahoo's own
   * coverage windows; 'mlb' derives values from the public MLB Stats API (game logs),
   * which unlocks arbitrary windows (e.g. Last 14) and derived categories (e.g. QS).
   * Yahoo is still used for identity, ownership, and season rank regardless. Flag-gated
   * so the v2 path can be built and validated before it is turned on.
   */
  statsSource: z.enum(['yahoo', 'mlb']).default('yahoo'),
  /**
   * Which LLM backs the AI co-manager chat. 'mock' is a deterministic, offline
   * provider for local dev + tests; 'azure' calls Azure OpenAI. When 'azure', the
   * azureOpenAi* fields below are required (enforced by the refine).
   */
  chatProvider: z.enum(['mock', 'azure']).default('mock'),
  /** Azure OpenAI resource endpoint, e.g. https://my-aoai.openai.azure.com. */
  azureOpenAiEndpoint: z.string().url().optional(),
  /** Azure OpenAI API key (local dev only; prod uses Managed Identity). Never logged. */
  azureOpenAiApiKey: z.string().min(1).optional(),
  /** The model deployment name to call, e.g. gpt-4o-mini. */
  azureOpenAiDeployment: z.string().min(1).optional(),
  /** Azure OpenAI REST API version. */
  azureOpenAiApiVersion: z.string().min(1).default('2024-10-21'),
}).refine(
  (c) =>
    c.chatProvider !== 'azure' ||
    (Boolean(c.azureOpenAiEndpoint) && Boolean(c.azureOpenAiApiKey) && Boolean(c.azureOpenAiDeployment)),
  {
    message:
      'CHAT_PROVIDER=azure requires AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT.',
    path: ['chatProvider'],
  },
);

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Parse and validate configuration from the environment. Fails fast with a clear
 * message (never echoing secret values) so misconfiguration is caught at startup.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse({
    yahooClientId: env.YAHOO_CLIENT_ID,
    yahooClientSecret: env.YAHOO_CLIENT_SECRET,
    yahooRedirectUri: env.YAHOO_REDIRECT_URI,
    webAppUrl: env.WEB_APP_URL,
    sessionSecret: env.SESSION_SECRET,
    port: env.PORT,
    tokenEncKey: env.TOKEN_ENC_KEY,
    tokenRefreshSkewSeconds: env.TOKEN_REFRESH_SKEW_SECONDS,
    dataMode: env.DATA_MODE,
    statsSource: env.STATS_SOURCE,
    chatProvider: env.CHAT_PROVIDER,
    azureOpenAiEndpoint: env.AZURE_OPENAI_ENDPOINT,
    azureOpenAiApiKey: env.AZURE_OPENAI_API_KEY,
    azureOpenAiDeployment: env.AZURE_OPENAI_DEPLOYMENT,
    azureOpenAiApiVersion: env.AZURE_OPENAI_API_VERSION,
  });

  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(
      `Invalid or missing environment configuration for: ${missing}. ` +
        `Copy .env.example to .env and fill in values.`,
    );
  }

  return result.data;
}

/** Absolute path to the API package directory (for resolving relative cert paths). */
export const API_DIR = apiDir;
