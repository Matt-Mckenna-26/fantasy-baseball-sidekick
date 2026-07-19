import { Router } from 'express';
import {
  chatDeltaEventSchema,
  chatDoneEventSchema,
  chatRequestSchema,
  chatToolEventSchema,
  type ChatStreamEvent,
} from '@fcm/contracts';
import type { AppConfig } from '../config.js';
import type { FantasyProvider } from '../fantasyProvider.js';
import type { TokenStore } from '../tokenStore.js';
import { ensureFreshTokens } from '../tokenRefresh.js';
import { asyncHandler, sendError } from '../http.js';
import { isLeagueAllowed } from '../closedBeta.js';
import { createLlmProvider } from '../ai/llmProvider.js';
import { runChat } from '../ai/chatOrchestrator.js';

/**
 * AI co-manager chat. Authenticated (needs the session's Yahoo tokens so the tools can
 * read the user's league data) and read-only. The LLM provider is chosen once from config
 * (mock by default, Azure OpenAI when configured). The tool-calling loop and token budgets
 * live in the orchestrator; this route only validates input and enforces the allowlist.
 *
 * The reply is streamed as NDJSON (one JSON event per line): live `tool` events as each
 * read-only tool runs, then a terminating `done` event carrying the full reply (or an
 * `error` event if the turn fails after streaming has begun). Pre-run failures
 * (auth/validation/allowlist) are still returned as plain JSON error envelopes.
 */
export function createChatRouter(
  config: AppConfig,
  tokenStore: TokenStore,
  provider: FantasyProvider,
): Router {
  const llm = createLlmProvider(config);
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      // Refresh proactively (single-flight) so the tool loop's Yahoo reads start with a
      // valid token instead of racing per-call refreshes mid-stream.
      const tokens = await ensureFreshTokens({ sessionId: req.sessionID, store: tokenStore, config });
      if (!tokens) {
        sendError(res, 401, 'unauthorized', 'Connect your Yahoo account first.');
        return;
      }
      const parsed = chatRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(res, 400, 'bad_request', 'Invalid chat request.');
        return;
      }
      const { leagueId, teamName, leagueName, messages } = parsed.data;
      if (leagueId && !isLeagueAllowed(leagueId)) {
        sendError(res, 403, 'league_not_allowed', 'This league is not in the closed beta group.');
        return;
      }

      // Switch to a streaming NDJSON response now that the request has passed all the
      // pre-run gates. One validated JSON event per line.
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.flushHeaders();
      const write = (event: ChatStreamEvent): void => {
        res.write(`${JSON.stringify(event)}\n`);
      };

      try {
        const result = await runChat({
          messages,
          tokens,
          provider,
          llm,
          ...(leagueId ? { leagueId } : {}),
          ...(teamName ? { teamName } : {}),
          ...(leagueName ? { leagueName } : {}),
          onTokensRefreshed: (refreshed) => tokenStore.save(req.sessionID, refreshed),
          onToolEvent: (event) => write(chatToolEventSchema.parse({ type: 'tool', ...event })),
          onAssistantDelta: (text) => write(chatDeltaEventSchema.parse({ type: 'delta', text })),
          onResetAssistant: () => write({ type: 'reset' }),
        });

        write(
          chatDoneEventSchema.parse({
            type: 'done',
            message: result.message,
            ...(result.toolsUsed.length > 0 ? { toolsUsed: result.toolsUsed } : {}),
            ...(result.usage ? { usage: result.usage } : {}),
            ...(result.playersMentioned && result.playersMentioned.length > 0
              ? { playersMentioned: result.playersMentioned }
              : {}),
          }),
        );
        res.end();
      } catch (err) {
        // Headers are already sent, so we can't fall back to a JSON error status; surface
        // the failure as a stream event and log the detail server-side.
        console.error('Chat stream failed:', err instanceof Error ? (err.stack ?? err.message) : err);
        write({ type: 'error', code: 'internal_error', message: 'Something went wrong.' });
        res.end();
      }
    }),
  );

  return router;
}
