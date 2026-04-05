/**
 * Shared runtime utility functions.
 * Canonical location for isSilentAck, stripHeartbeatToken, currentTimeLine.
 */

/**
 * Generate current time line for prompt injection (OpenClaw pattern).
 */
export function currentTimeLine(): string {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const utcStr = now.toISOString().replace("T", " ").substring(0, 16) + " UTC";
  return `Current time: ${timeStr}, ${dateStr} / ${utcStr}`;
}

/**
 * Check if a response is a silent ack (HEARTBEAT_OK or equivalent).
 * Catches verbose responses where the agent wraps the token in reasoning text.
 */
export function isSilentAck(text: string, maxChars: number = 500): boolean {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (trimmed.length < 150) {
    const silentTokens = [
      "heartbeat_ok",
      "heartbeat ok",
      "all clear",
      "nothing to report",
      "nothing needs attention",
      "no action needed",
      "all good",
      "no issues found",
      "nothing new",
    ];
    if (silentTokens.some(token => lower.includes(token))) return true;
    if (trimmed.length < 50 && lower.includes("clear")) return true;
  }

  if (lower.includes("heartbeat_ok") || lower.includes("heartbeat ok")) {
    const stripped = trimmed.replace(/heartbeat[_\s]?ok/gi, "").trim();
    if (stripped.length < maxChars) {
      const fillerPatterns = [
        /just\s+(send|say|reply|do)/i,
        /same\s+(picture|pattern|as\s*before|as\s+last)/i,
        /nothing\s+(new|changed|different|to\s+flag)/i,
        /repetitive/i,
        /monitoring/i,
        /no\s+(new|actionable)/i,
        /all\s+clear/i,
        /no\s+escalation/i,
        /pattern\s+has\s+been/i,
        /nothing\s+urgent/i,
      ];
      const isFiller = fillerPatterns.some(p => stripped.match(p));
      if (isFiller || stripped.length < 100) {
        return true;
      }
    }
  }

  if (trimmed.length < 50 && lower.includes("clear")) return true;

  return false;
}

/**
 * Strip HEARTBEAT_OK token from response text.
 */
export function stripHeartbeatToken(text: string): string {
  return text
    .replace(/heartbeat[_\s]?ok/gi, "")
    .trim();
}

/**
 * Check if text contains substantive findings (not just monitoring noise).
 */
export function hasSubstantiveFinding(text: string): boolean {
  const lower = text.toLowerCase().trim();

  const passivePatterns = [
    /^same\s+(picture|pattern|as\s*before|as\s+last)/i,
    /nothing\s+(new|changed|different|to\s+flag|urgent)/i,
    /just\s+(monitoring|checking|watching)/i,
    /no\s+(new|actionable|overdue|blockers?)/i,
    /all\s+clear/i,
    /repetitive/i,
    /no\s+escalation\s+needed/i,
  ];
  if (passivePatterns.some(p => lower.match(p))) return false;

  const substantivePatterns = [
    /\d+\s*(tasks?|cards?|items?|projects?|risks?|changes?)/i,
    /overdue|blocked|stalled|stale/i,
    /action\s+(taken|required|needed|recommended)/i,
    /recommend|suggest|advise/i,
    /anomal|spike|drop|increase|decrease/i,
    /update|fix|resolve|address/i,
    /deadline|missed|delay/i,
    /escalate|escalation|critical|urgent/i,
    /spent|revenue|budget|cost/i,
    /sleep|workout|exercise|mood|nutrition|calories/i,
    /follow.?up|contact|relationship|connection/i,
    /content|pipeline|publish|stale|draft/i,
  ];
  return substantivePatterns.some(p => lower.match(p));
}
