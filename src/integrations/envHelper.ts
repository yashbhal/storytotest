/**
 * Small helpers for reading typed values from process.env.
 * Centralises boolean parsing and required-string checks so that
 * webhook entrypoints stay concise.
 */

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function envString(name: string, fallback: string = ""): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export function envBool(name: string, fallback: boolean = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

export function envInt(name: string, fallback?: number): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}
