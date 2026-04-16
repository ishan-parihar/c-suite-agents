type MetricKey = string;

const counters = new Map<MetricKey, number>();
const gauges = new Map<MetricKey, number>();

function metricKey(name: string, labels?: Record<string, string>): MetricKey {
  if (!labels || Object.keys(labels).length === 0) return name;
  const serialized = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
    .join(",");
  return `${name}{${serialized}}`;
}

export function incrementCounter(name: string, amount = 1, labels?: Record<string, string>): void {
  const key = metricKey(name, labels);
  counters.set(key, (counters.get(key) || 0) + amount);
}

export function setGauge(name: string, value: number, labels?: Record<string, string>): void {
  gauges.set(metricKey(name, labels), value);
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [];

  for (const [key, value] of counters) {
    lines.push(`${key} ${value}`);
  }

  for (const [key, value] of gauges) {
    lines.push(`${key} ${value}`);
  }

  return `${lines.join("\n")}\n`;
}
