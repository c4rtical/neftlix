// Assembles desktop/dist for electron-builder: compiled server + web build.
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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
// The server's own CLI entry point; the desktop app only ever imports server/app.js.
rmSync(join(dist, 'server', 'index.js'), { force: true });

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const desktopPkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'));
if (desktopPkg.version !== version) {
  console.error(`version mismatch: root ${version}, desktop ${desktopPkg.version}. Run: npm version ${version} --workspaces --include-workspace-root --no-git-tag-version`);
  process.exit(1);
}

// electron-builder cannot resolve the hoisted semver range under npm workspaces, so
// electron-builder.yml pins an exact electronVersion by hand — make sure it hasn't drifted
// from the "electron" devDependency actually installed.
const builderYml = readFileSync(resolve(here, '../electron-builder.yml'), 'utf8');
const pinMatch = builderYml.match(/^electronVersion:\s*(\S+)\s*$/m);
if (!pinMatch) {
  console.error('electron-builder.yml: could not find an "electronVersion:" line');
  process.exit(1);
}
const require = createRequire(import.meta.url);
const installedElectronVersion = JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8')).version;
if (pinMatch[1] !== installedElectronVersion) {
  console.error(
    `electronVersion mismatch: electron-builder.yml pins ${pinMatch[1]}, but electron@${installedElectronVersion} is installed. Update the "electronVersion:" line in desktop/electron-builder.yml to match.`,
  );
  process.exit(1);
}

console.log(`desktop/dist ready (v${version})`);
