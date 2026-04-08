import { createHash } from 'node:crypto';
import { logger } from '../logger.js';

export type LoopDetectorKind =
  | 'generic_repeat'
  | 'known_poll_no_progress'
  | 'global_circuit_breaker'
  | 'ping_pong';

export type LoopDetectionResult =
  | { stuck: false }
  | {
      stuck: true;
      level: 'warning' | 'critical';
      detector: LoopDetectorKind;
      count: number;
      message: string;
      pairedToolName?: string;
      warningKey?: string;
    };

export interface ToolLoopDetectionConfig {
  enabled: boolean;
  historySize: number;
  warningThreshold: number;
  criticalThreshold: number;
  globalCircuitBreakerThreshold: number;
  detectors: {
    genericRepeat: boolean;
    knownPollNoProgress: boolean;
    pingPong: boolean;
  };
}

export interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  toolCallId?: string;
  resultHash?: string;
  timestamp: number;
}

export const DEFAULT_LOOP_DETECTION_CONFIG: ToolLoopDetectionConfig = {
  enabled: false,
  historySize: 30,
  warningThreshold: 10,
  criticalThreshold: 20,
  globalCircuitBreakerThreshold: 30,
  detectors: {
    genericRepeat: true,
    knownPollNoProgress: true,
    pingPong: true,
  },
};

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function stableStringifyFallback(value: unknown): string {
  try {
    return stableStringify(value);
  } catch {
    if (value === null || value === undefined) {
      return String(value);
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    if (value instanceof Error) {
      return `${value.name}:${value.message}`;
    }
    return Object.prototype.toString.call(value);
  }
}

function digestStable(value: unknown): string {
  const serialized = stableStringifyFallback(value);
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Hash a tool call for pattern matching.
 */
export function hashToolCall(toolName: string, params: unknown): string {
  return `${toolName}:${digestStable(params)}`;
}

/**
 * Hash the outcome of a tool call for no-progress detection.
 */
export function hashToolOutcome(
  toolName: string,
  params: unknown,
  result: unknown,
  error?: unknown,
): string | undefined {
  if (error !== undefined) {
    return `error:${digestStable(formatErrorForHash(error))}`;
  }
  if (result === undefined) {
    return undefined;
  }
  if (!isPlainObject(result)) {
    return digestStable(result);
  }
  const obj = result as Record<string, unknown>;
  const details = isPlainObject(obj.details) ? (obj.details as Record<string, unknown>) : {};
  const text = extractTextContent(result);

  if (isKnownPollTool(toolName)) {
    return digestStable({
      status: details.status ?? null,
      exitCode: details.exitCode ?? null,
      exitSignal: details.exitSignal ?? null,
      text,
    });
  }

  return digestStable({
    details,
    text,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

function extractTextContent(result: unknown): string {
  if (!isPlainObject(result)) return '';
  const content = result.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (entry): entry is { type: string; text: string } =>
        isPlainObject(entry) && typeof entry.type === 'string' && typeof entry.text === 'string',
    )
    .map((entry) => entry.text)
    .join('\n')
    .trim();
}

function formatErrorForHash(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'number' || typeof error === 'boolean' || typeof error === 'bigint') {
    return String(error);
  }
  return stableStringifyFallback(error);
}

const KNOWN_POLL_KEYWORDS = [
  'status',
  'poll',
  'check',
  'get_result',
  'wait',
  'heartbeat',
  'is_ready',
  'get_status',
] as const;

function isKnownPollTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return KNOWN_POLL_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function getNoProgressStreak(
  history: ToolCallRecord[],
  toolName: string,
  argsHash: string,
): { count: number; latestResultHash: string | undefined } {
  let streak = 0;
  let latestResultHash: string | undefined;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const record = history[i];
    if (!record || record.toolName !== toolName || record.argsHash !== argsHash) {
      continue;
    }
    if (typeof record.resultHash !== 'string' || record.resultHash.length === 0) {
      continue;
    }
    if (latestResultHash === undefined) {
      latestResultHash = record.resultHash;
      streak = 1;
      continue;
    }
    if (record.resultHash !== latestResultHash) {
      break;
    }
    streak += 1;
  }

  return { count: streak, latestResultHash };
}

function getPingPongStreak(
  history: ToolCallRecord[],
  currentSignature: string,
): {
  count: number;
  pairedToolName: string | undefined;
  pairedSignature: string | undefined;
  noProgressEvidence: boolean;
} {
  const last = history.at(-1);
  if (!last) {
    return { count: 0, pairedToolName: undefined, pairedSignature: undefined, noProgressEvidence: false };
  }

  let otherSignature: string | undefined;
  let otherToolName: string | undefined;
  for (let i = history.length - 2; i >= 0; i -= 1) {
    const call = history[i];
    if (!call) continue;
    if (call.argsHash !== last.argsHash) {
      otherSignature = call.argsHash;
      otherToolName = call.toolName;
      break;
    }
  }

  if (otherSignature === undefined || otherToolName === undefined) {
    return { count: 0, pairedToolName: undefined, pairedSignature: undefined, noProgressEvidence: false };
  }

  let alternatingTailCount = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const call = history[i];
    if (!call) continue;
    const expected = alternatingTailCount % 2 === 0 ? last.argsHash : otherSignature;
    if (call.argsHash !== expected) {
      break;
    }
    alternatingTailCount += 1;
  }

  // Need at least 4 alternating calls (2 full round-trips)
  if (alternatingTailCount < 4) {
    return { count: 0, pairedToolName: undefined, pairedSignature: undefined, noProgressEvidence: false };
  }

  const expectedNextSignature = otherSignature;
  if (currentSignature !== expectedNextSignature) {
    return { count: 0, pairedToolName: undefined, pairedSignature: undefined, noProgressEvidence: false };
  }

  let noProgressEvidence = true;
  let firstHashA: string | undefined;
  let firstHashB: string | undefined;
  const tailStart = Math.max(0, history.length - alternatingTailCount);

  for (let i = tailStart; i < history.length; i += 1) {
    const call = history[i];
    if (!call) continue;
    if (!call.resultHash) {
      noProgressEvidence = false;
      break;
    }
    if (call.argsHash === last.argsHash) {
      if (firstHashA === undefined) {
        firstHashA = call.resultHash;
      } else if (firstHashA !== call.resultHash) {
        noProgressEvidence = false;
        break;
      }
    } else if (call.argsHash === otherSignature) {
      if (firstHashB === undefined) {
        firstHashB = call.resultHash;
      } else if (firstHashB !== call.resultHash) {
        noProgressEvidence = false;
        break;
      }
    } else {
      noProgressEvidence = false;
      break;
    }
  }

  if (firstHashA === undefined || firstHashB === undefined) {
    noProgressEvidence = false;
  }

  return {
    count: alternatingTailCount + 1, // +1 for the call about to be made
    pairedToolName: otherToolName,
    pairedSignature: otherSignature,
    noProgressEvidence,
  };
}

function canonicalPairKey(signatureA: string, signatureB: string): string {
  return [signatureA, signatureB].sort().join('|');
}

/**
 * Detect if a tool call would create a repetitive loop.
 * Checks detectors in cascade order:
 * 1. global_circuit_breaker (critical, blocks execution)
 * 2. known_poll_no_progress (warning → critical)
 * 3. ping_pong (warning → critical)
 * 4. generic_repeat (warning only)
 */
export function detectToolCallLoop(
  history: ToolCallRecord[],
  toolName: string,
  params: unknown,
  config: ToolLoopDetectionConfig,
): LoopDetectionResult {
  if (!config.enabled) {
    return { stuck: false };
  }

  const currentHash = hashToolCall(toolName, params);
  const noProgress = getNoProgressStreak(history, toolName, currentHash);
  const noProgressStreak = noProgress.count;
  const knownPollTool = isKnownPollTool(toolName);
  const pingPong = getPingPongStreak(history, currentHash);

  if (noProgressStreak >= config.globalCircuitBreakerThreshold) {
    logger.error(
      `Global circuit breaker triggered: ${toolName} repeated ${noProgressStreak} times with no progress`,
    );
    return {
      stuck: true,
      level: 'critical',
      detector: 'global_circuit_breaker',
      count: noProgressStreak,
      message: `CRITICAL: ${toolName} has repeated identical no-progress outcomes ${noProgressStreak} times. Session execution blocked by global circuit breaker to prevent runaway loops.`,
      warningKey: `global:${toolName}:${currentHash}:${noProgress.latestResultHash ?? 'none'}`,
    };
  }

  if (config.detectors.knownPollNoProgress && knownPollTool) {
    if (noProgressStreak >= config.criticalThreshold) {
      logger.error(`Critical polling loop detected: ${toolName} repeated ${noProgressStreak} times`);
      return {
        stuck: true,
        level: 'critical',
        detector: 'known_poll_no_progress',
        count: noProgressStreak,
        message: `CRITICAL: Called ${toolName} with identical arguments and no progress ${noProgressStreak} times. This appears to be a stuck polling loop. Session execution blocked to prevent resource waste.`,
        warningKey: `poll:${toolName}:${currentHash}:${noProgress.latestResultHash ?? 'none'}`,
      };
    }

    if (noProgressStreak >= config.warningThreshold) {
      logger.warn(`Polling loop warning: ${toolName} repeated ${noProgressStreak} times`);
      return {
        stuck: true,
        level: 'warning',
        detector: 'known_poll_no_progress',
        count: noProgressStreak,
        message: `WARNING: You have called ${toolName} ${noProgressStreak} times with identical arguments and no progress. Stop polling and either (1) increase wait time between checks, or (2) report the task as failed if the process is stuck.`,
        warningKey: `poll:${toolName}:${currentHash}:${noProgress.latestResultHash ?? 'none'}`,
      };
    }
  }

  const pingPongWarningKey = pingPong.pairedSignature
    ? `pingpong:${canonicalPairKey(currentHash, pingPong.pairedSignature)}`
    : `pingpong:${toolName}:${currentHash}`;

  if (config.detectors.pingPong && pingPong.count >= config.criticalThreshold && pingPong.noProgressEvidence) {
    logger.error(
      `Critical ping-pong loop detected: alternating calls count=${pingPong.count} currentTool=${toolName}`,
    );
    return {
      stuck: true,
      level: 'critical',
      detector: 'ping_pong',
      count: pingPong.count,
      message: `CRITICAL: You are alternating between repeated tool-call patterns (${pingPong.count} consecutive calls) with no progress. This appears to be a stuck ping-pong loop. Session execution blocked to prevent resource waste.`,
      pairedToolName: pingPong.pairedToolName,
      warningKey: pingPongWarningKey,
    };
  }

  if (config.detectors.pingPong && pingPong.count >= config.warningThreshold) {
    logger.warn(
      `Ping-pong loop warning: alternating calls count=${pingPong.count} currentTool=${toolName}`,
    );
    return {
      stuck: true,
      level: 'warning',
      detector: 'ping_pong',
      count: pingPong.count,
      message: `WARNING: You are alternating between repeated tool-call patterns (${pingPong.count} consecutive calls). This looks like a ping-pong loop; stop retrying and report the task as failed.`,
      pairedToolName: pingPong.pairedToolName,
      warningKey: pingPongWarningKey,
    };
  }

  const recentCount = history.filter(
    (h) => h.toolName === toolName && h.argsHash === currentHash,
  ).length;

  if (config.detectors.genericRepeat && recentCount >= config.warningThreshold) {
    logger.warn(`Loop warning: ${toolName} called ${recentCount} times with identical arguments`);
    return {
      stuck: true,
      level: 'warning',
      detector: 'generic_repeat',
      count: recentCount,
      message: `WARNING: You have called ${toolName} ${recentCount} times with identical arguments. If this is not making progress, stop retrying and report the task as failed.`,
      warningKey: `generic:${toolName}:${currentHash}`,
    };
  }

  return { stuck: false };
}

/**
 * Record a tool call, returns new history array with size limit enforced.
 */
export function recordToolCall(
  history: ToolCallRecord[],
  toolName: string,
  params: unknown,
  toolCallId?: string,
): ToolCallRecord[] {
  const newRecord: ToolCallRecord = {
    toolName,
    argsHash: hashToolCall(toolName, params),
    toolCallId,
    timestamp: Date.now(),
  };

  const updated = [...history, newRecord];
  if (updated.length > DEFAULT_LOOP_DETECTION_CONFIG.historySize) {
    return updated.slice(updated.length - DEFAULT_LOOP_DETECTION_CONFIG.historySize);
  }
  return updated;
}

/**
 * Record outcome, matches by toolCallId or toolName+argsHash, returns new history.
 */
export function recordToolCallOutcome(
  history: ToolCallRecord[],
  toolName: string,
  params: unknown,
  result: unknown,
  error?: unknown,
  toolCallId?: string,
): ToolCallRecord[] {
  const resultHash = hashToolOutcome(toolName, params, result, error);
  if (resultHash === undefined) {
    return [...history];
  }

  const argsHash = hashToolCall(toolName, params);
  let matched = false;
  const updated = history.map((call) => {
    if (matched) return call;
    if (toolCallId && call.toolCallId !== toolCallId) {
      return call;
    }
    if (call.toolName !== toolName || call.argsHash !== argsHash) {
      return call;
    }
    if (call.resultHash !== undefined) {
      return call;
    }
    matched = true;
    return { ...call, resultHash };
  });

  if (!matched) {
    const newRecord: ToolCallRecord = {
      toolName,
      argsHash,
      toolCallId,
      resultHash,
      timestamp: Date.now(),
    };
    const appended = [...updated, newRecord];
    if (appended.length > DEFAULT_LOOP_DETECTION_CONFIG.historySize) {
      return appended.slice(appended.length - DEFAULT_LOOP_DETECTION_CONFIG.historySize);
    }
    return appended;
  }

  return updated;
}

export function getToolCallStats(history: ToolCallRecord[]): {
  totalCalls: number;
  uniquePatterns: number;
  mostFrequent: { toolName: string; count: number } | null;
} {
  const patterns = new Map<string, { toolName: string; count: number }>();

  for (const call of history) {
    const key = call.argsHash;
    const existing = patterns.get(key);
    if (existing !== undefined) {
      existing.count += 1;
    } else {
      patterns.set(key, { toolName: call.toolName, count: 1 });
    }
  }

  let mostFrequent: { toolName: string; count: number } | null = null;
  for (const pattern of patterns.values()) {
    if (mostFrequent === null || pattern.count > mostFrequent.count) {
      mostFrequent = pattern;
    }
  }

  return {
    totalCalls: history.length,
    uniquePatterns: patterns.size,
    mostFrequent,
  };
}
