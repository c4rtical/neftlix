export type ReleaseAsset = { name: string; browser_download_url: string; size: number };
export type PickedAsset = { name: string; url: string; size: number };

export function parseTag(tag: string): string | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : null;
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function pickAsset(assets: ReleaseAsset[], platform: NodeJS.Platform): PickedAsset | null {
  const match = (re: RegExp) => assets.find((a) => re.test(a.name));
  const found =
    platform === 'darwin'
      ? (match(/-universal\.dmg$/) ?? match(/\.dmg$/))
      : platform === 'win32'
        ? match(/^Neftlix-Setup-.*\.exe$/)
        : undefined;
  return found ? { name: found.name, url: found.browser_download_url, size: found.size } : null;
}
