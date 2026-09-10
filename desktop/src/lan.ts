/** "Apri dalla TV": persisted switch + PIN, and the LAN addresses to show in Settings. */
import { randomBytes, randomInt } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

export type LanState = { enabled: boolean; pin: string; secret: string };

export const PIN_RE = /^[0-9]{4,8}$/;

export function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function defaultLanState(): LanState {
  return { enabled: false, pin: generatePin(), secret: randomBytes(32).toString('hex') };
}

export function loadLanState(file: string): LanState {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LanState>;
    const pin = typeof raw.pin === 'string' && PIN_RE.test(raw.pin) ? raw.pin : generatePin();
    const secret = typeof raw.secret === 'string' && raw.secret.length >= 32 ? raw.secret : randomBytes(32).toString('hex');
    return { enabled: raw.enabled === true, pin, secret };
  } catch {
    return defaultLanState();
  }
}

export function saveLanState(file: string, state: LanState): void {
  writeFileSync(file, JSON.stringify(state));
}

type Iface = { family: string | number; internal: boolean; address: string };

function isPrivateV4(ip: string): boolean {
  return ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/** IPv4 addresses of this machine that other devices on the network can reach, private ranges first. */
export function lanAddresses(ifaces: Record<string, Iface[] | undefined> = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      const v4 = i.family === 'IPv4' || i.family === 4;
      if (!v4 || i.internal || i.address.startsWith('169.254.')) continue;
      out.push(i.address);
    }
  }
  return [...new Set(out)].sort((a, b) => Number(isPrivateV4(b)) - Number(isPrivateV4(a)) || a.localeCompare(b));
}
