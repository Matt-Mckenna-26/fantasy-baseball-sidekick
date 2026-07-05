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
   * Data source for authed Yahoo data. 'live' calls the real Yahoo Fantasy API;
   * 'mock' serves fixture data through the same DTOs. Auth (Yahoo OAuth) is always
   * enforced regardless - only the data boundary changes.
   */
  dataMode: z.enum(['live', 'mock']).default('live'),
});

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
    dataMode: env.DATA_MODE,
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
