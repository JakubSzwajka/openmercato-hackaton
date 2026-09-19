import {
  getOpenCodeProviderConfiguredEnvKey,
  isOpenCodeProviderConfigured,
  OPEN_CODE_PROVIDERS,
  type OpenCodeProviderId,
} from '@open-mercato/shared/lib/ai/opencode-provider'
import {
  resolveConfiguredStructuredModel,
  resolveExtractionProviderId,
  runExtractionWithConfiguredProvider,
  withTimeout,
} from '@open-mercato/core/modules/inbox_ops/lib/llmProvider'
import { z } from 'zod'

/**
 * Tells an operator, in a few seconds, whether the model half of this demo will
 * work, WITHOUT ever revealing a key.
 *
 * Every function here reports presence, never value. `describeAiProvider` names
 * the env var that holds the key and whether it is set; `probeAiProvider` makes
 * one small real call. Error text is scrubbed by {@link redactSecrets} before it
 * is returned, because an SDK is free to echo a request header into an
 * exception and the whole point of a smoke check is that it is safe to paste
 * into a chat.
 */

/** Marker the log grep in the walkthrough looks for. */
export const AI_PROBE_MARKER = 'OFFER_AUTOMATION_AI_PROBE'

export type AiProviderDescription = {
  providerId: OpenCodeProviderId
  providerName: string
  /** Env var that would hold the key, e.g. `OPENAI_API_KEY`. Never the value. */
  apiKeyEnvVar: string
  apiKeyPresent: boolean
  /** e.g. `openai/gpt-5-mini`. Resolved through the same path extraction uses. */
  modelWithProvider: string | null
  /** Set when the model could not even be constructed. Already redacted. */
  configurationError: string | null
}

export type AiProbeFailureClass =
  | 'no_provider_configured'
  | 'missing_api_key'
  | 'schema_rejected'
  | 'auth_rejected'
  | 'quota_or_rate_limit'
  | 'model_not_available'
  | 'network_unreachable'
  | 'timed_out'
  | 'unknown'

export type AiProbeResult =
  | { ok: true; modelWithProvider: string; tokensUsed: number; elapsedMs: number }
  | { ok: false; failure: AiProbeFailureClass; detail: string; hint: string; elapsedMs: number }

/**
 * Removes anything shaped like a credential from a message.
 *
 * Deliberately blunt: a long opaque token is redacted whether or not it really
 * is a key. Losing a few characters of an error message costs nothing; printing
 * a key once costs the key.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{8,}/g, '$1-<redacted>')
    .replace(/\bAIza[A-Za-z0-9_-]{10,}/g, 'AIza<redacted>')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<redacted>')
    .replace(
      /(authorization|api[-_ ]?key|bearer)(["'\s:=]+)[^\s"',}]+/gi,
      (_match, label: string, sep: string) => `${label}${sep}<redacted>`,
    )
}

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return redactSecrets(raw)
}

/**
 * Reads the configuration without calling anything.
 *
 * Safe when there is no network, no key and no provider: every failure is
 * captured into `configurationError` instead of thrown, because this function's
 * job is to describe a broken setup, not to join it.
 */
export async function describeAiProvider(): Promise<AiProviderDescription> {
  let providerId: OpenCodeProviderId
  try {
    providerId = resolveExtractionProviderId()
  } catch {
    // The resolver throws when OM_AI_PROVIDER names a gateway the native switch
    // cannot serve. The factory below may still resolve it, so keep going with
    // the default provider for the env-var report.
    providerId = 'openai'
  }

  const description: AiProviderDescription = {
    providerId,
    providerName: OPEN_CODE_PROVIDERS[providerId].name,
    apiKeyEnvVar: getOpenCodeProviderConfiguredEnvKey(providerId),
    apiKeyPresent: isOpenCodeProviderConfigured(providerId),
    modelWithProvider: null,
    configurationError: null,
  }

  try {
    const resolved = await resolveConfiguredStructuredModel({ moduleId: 'inbox_ops' })
    description.modelWithProvider = resolved.modelWithProvider
  } catch (error) {
    description.configurationError = messageOf(error)
  }

  return description
}

/**
 * Sorts a failure into something an operator can act on.
 *
 * Matches on message text because the AI SDK wraps provider errors in several
 * shapes and none of them carries a stable code through `generateObject`. The
 * classification is a convenience; `detail` always carries the redacted
 * original so nothing is hidden behind a wrong guess.
 */
export function classifyProbeFailure(message: string): AiProbeFailureClass {
  const text = message.toLowerCase()
  if (text.includes('no_provider_configured') || text.includes('not configured')) {
    return 'no_provider_configured'
  }
  if (text.includes('missing api key')) return 'missing_api_key'
  // Checked before the 4xx patterns: OpenAI returns this as a 400, so a generic
  // status match would file the most likely failure on this stack under
  // "unknown" and send an operator hunting for a key problem that is not there.
  if (
    text.includes('invalid schema for response_format') ||
    (text.includes("'required' is required to be supplied") && text.includes('properties'))
  ) {
    return 'schema_rejected'
  }
  if (text.includes('timed out') || text.includes('etimedout')) return 'timed_out'
  if (
    text.includes('401') ||
    text.includes('403') ||
    text.includes('unauthorized') ||
    text.includes('incorrect api key') ||
    text.includes('invalid_api_key') ||
    text.includes('authentication')
  ) {
    return 'auth_rejected'
  }
  if (
    text.includes('429') ||
    text.includes('quota') ||
    text.includes('rate limit') ||
    text.includes('insufficient_quota') ||
    text.includes('billing')
  ) {
    return 'quota_or_rate_limit'
  }
  if (
    text.includes('model_not_found') ||
    text.includes('does not exist') ||
    text.includes('unsupported model') ||
    text.includes('404')
  ) {
    return 'model_not_available'
  }
  if (
    text.includes('enotfound') ||
    text.includes('econnrefused') ||
    text.includes('econnreset') ||
    text.includes('fetch failed') ||
    text.includes('network')
  ) {
    return 'network_unreachable'
  }
  return 'unknown'
}

const HINTS: Record<AiProbeFailureClass, string> = {
  no_provider_configured:
    'Set OM_AI_PROVIDER and the matching API key env var in .env, then re-run. The stub path (`demo` without --live) needs neither.',
  missing_api_key: 'Set the API key env var named above in .env. Never commit it.',
  schema_rejected:
    'NOT a key or quota problem, and nothing in this module can fix it. OpenAI strict structured outputs requires every property to be listed as required, and core\'s extractionOutputSchema (node_modules/@open-mercato/core/src/modules/inbox_ops/data/validators.ts:196, :213-215, :220, :232-233) marks several optional. Every email fails the same way, not just ours. Either configure a provider that does not apply strict schemas (OM_AI_PROVIDER=anthropic or google, with that provider\'s key), or demo the stub path (`demo` without --live), which needs no model.',
  auth_rejected:
    'The key was rejected. Check it is current and belongs to an account with this model enabled. Demo the stub path (`demo` without --live) meanwhile.',
  quota_or_rate_limit:
    'The account is out of quota or rate-limited. Wait, top up, or demo the stub path (`demo` without --live).',
  model_not_available:
    'This account cannot use OM_AI_MODEL. Pick a model it can use, or set OM_AI_INBOX_OPS_MODEL for this module only.',
  network_unreachable:
    'No route to the provider. Check the network or a proxy, then re-run. The stub path needs no network.',
  timed_out:
    'The call ran past INBOX_OPS_LLM_TIMEOUT_MS. Retry once; if it repeats, demo the stub path.',
  unknown: 'Unclassified failure. The redacted provider message is above.',
}

/** Smallest schema that is strict-safe: every property required, no optionals. */
const probeSchema = z.object({ ok: z.boolean(), note: z.string() })

/**
 * Is the model reachable at all?
 *
 * Uses a strict-safe schema, so it isolates provider, key, network and model
 * from the schema question that {@link probeCoreExtractionSchema} asks. This is
 * the probe that predicts whether `demo --live` (mode `app`) will work.
 */
export async function probeAiProvider(timeoutMs = 30_000): Promise<AiProbeResult> {
  const startedAt = Date.now()
  try {
    const resolved = await resolveConfiguredStructuredModel({ moduleId: 'inbox_ops' })
    // Lazy for the same reason as in `freightExtraction.ts`: `ai` is ESM-only.
    const { generateObject } = await import('ai')
    const result = await withTimeout(
      generateObject({
        model: resolved.model,
        schema: probeSchema,
        system: 'You are a connectivity probe. Answer ok=true and note="reachable".',
        prompt: 'Probe.',
        temperature: 0,
      }),
      timeoutMs,
      `Probe timed out after ${timeoutMs}ms`,
    )
    return {
      ok: true,
      modelWithProvider: resolved.modelWithProvider,
      tokensUsed: Number(result.usage?.totalTokens ?? 0) || 0,
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    const detail = messageOf(error)
    const failure = classifyProbeFailure(detail)
    return { ok: false, failure, detail, hint: HINTS[failure], elapsedMs: Date.now() - startedAt }
  }
}

/**
 * Will ROUTE A work? That is, can this provider accept core's own extraction
 * schema?
 *
 * Calls `runExtractionWithConfiguredProvider` unchanged, which is exactly what
 * the installed extraction worker calls. A failure here with a success above
 * means the provider is fine and core's schema is not, which is the situation
 * on this install and the reason the `app` live mode exists.
 */
export async function probeCoreExtractionSchema(timeoutMs = 30_000): Promise<AiProbeResult> {
  const startedAt = Date.now()
  try {
    const result = await runExtractionWithConfiguredProvider({
      systemPrompt:
        'You are a connectivity probe. Reply with summary "ok", category "other", confidence 1, detectedLanguage "en", and empty participants, proposedActions, discrepancies and draftReplies arrays.',
      userPrompt: 'Probe.',
      timeoutMs,
    })
    return {
      ok: true,
      modelWithProvider: result.modelWithProvider,
      tokensUsed: result.totalTokens,
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    const detail = messageOf(error)
    const failure = classifyProbeFailure(detail)
    return { ok: false, failure, detail, hint: HINTS[failure], elapsedMs: Date.now() - startedAt }
  }
}
