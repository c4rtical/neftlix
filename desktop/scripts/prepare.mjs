// Assembles desktop/dist for electron-builder: compiled server + web build + version stamp.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const dist = resolve(here, '../dist');
const serverDist = join(root, 'server/dist');
const webDist = join(root, 'web/dist');

for (const [name, dir] of [['server', serverDist], ['web', webDist]]) {
  if (!existsSync(join(dir, name === 'server' ? 'app.js' : 'index.html'))) {
    console.error(`missing ${dir}: run the ${name} build first`);
    process.exit(1);
  }
}

rmSync(join(dist, 'server'), { recursive: true, force: true });
rmSync(join(dist, 'web'), { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(serverDist, join(dist, 'server'), { recursive: true });
cpSync(webDist, join(dist, 'web'), { recursive: true });

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const desktopPkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'));
if (desktopPkg.version !== version) {
  console.error(`version mismatch: root ${version}, desktop ${desktopPkg.version}. Run: npm version ${version} --workspaces --include-workspace-root --no-git-tag-version`);
  process.exit(1);
}
writeFileSync(join(dist, 'version.json'), JSON.stringify({ version }));
console.log(`desktop/dist ready (v${version})`);
