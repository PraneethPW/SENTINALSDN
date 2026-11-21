import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { configureLocal, startHost, stopHost, drainLocal } from './lab-host.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = path.resolve(root, process.env.SENTINEL_LOCAL_ENV_FILE || '.env.local-stack');
const action = process.argv[2] || 'up';
if (!['up', 'down', 'status', 'logs', 'credentials'].includes(action))
  throw new Error('Use up, down, status, logs, or credentials');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) console.error(`Cannot run ${command}: ${result.error.message}. Check the prerequisites in docs/LOCAL_SETUP.md.`);
  if (result.status !== 0) process.exit(result.status || 1);
  return result;
}
if (!existsSync(file) && action !== 'up') throw new Error('Run npm run local:up first');
let contents = existsSync(file) ? readFileSync(file, 'utf8') : '';
const values = Object.fromEntries(contents.split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line)).map(line => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1).trim()];
}));
function set(key, value) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  contents = pattern.test(contents) ? contents.replace(pattern, `${key}=${value}`) : `${contents.trimEnd()}\n${key}=${value}\n`;
  values[key] = value;
}
if (action === 'credentials') {
  console.log(`LOCAL_ADMIN_EMAIL=${values.LOCAL_ADMIN_EMAIL}\nLOCAL_ADMIN_PASSWORD=${values.LOCAL_ADMIN_PASSWORD}`);
  process.exit(0);
}
const docker = spawnSync('docker', ['--version'], { stdio: 'ignore' });
if (docker.error) throw new Error('Docker is missing. Install Docker Desktop, Docker Engine, or Colima; see docs/LOCAL_SETUP.md.');
const current = spawnSync('docker', ['context', 'show'], { encoding: 'utf8' }).stdout?.trim() || 'default';
const active = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0;
const context = process.env.SENTINEL_DOCKER_CONTEXT || (active ? current : process.platform === 'darwin' ? 'colima-sentinel-sdn' : current);
if (action === 'up' && spawnSync('docker', ['--context', context, 'info'], { stdio: 'ignore' }).status !== 0) {
  if (process.platform === 'darwin' && context === 'colima-sentinel-sdn')
    run('colima', ['start', 'sentinel-sdn', '--vm-type', 'vz', '--cpus', '4', '--memory', '6', '--disk', '12', '--activate=false', '--ssh-config=false', '--mount', 'none']);
  else throw new Error(`Docker context ${context} is unavailable. Start its Docker daemon and retry.`);
}
if (action === 'up') {
  for (const key of ['LOCAL_DB_PASSWORD', 'LOCAL_COLLECTOR_TOKEN', 'LOCAL_LAB_HOST_TOKEN', 'LOCAL_ADMIN_PASSWORD'])
    if (!values[key]) set(key, randomBytes(32).toString('hex'));
  if (!values.LOCAL_ADMIN_EMAIL) set('LOCAL_ADMIN_EMAIL', 'admin@sentinel.local');
  for (const [key, fallback] of Object.entries({ LOCAL_FRONTEND_PORT: '5180', LOCAL_API_PORT: '8100', LOCAL_DB_PORT: '55432' })) {
    if (!values[key]) set(key, fallback);
    if (!/^\d+$/.test(values[key]) || Number(values[key]) < 1024 || Number(values[key]) > 65535)
      throw new Error(`${key} must be a port from 1024 to 65535`);
  }
  set('LOCAL_MODEL_SHA256', createHash('sha256').update(readFileSync(path.join(root, 'backend/artifacts/model.joblib'))).digest('hex'));
  set('LOCAL_MODEL_THRESHOLD', String(JSON.parse(readFileSync(path.join(root, 'backend/artifacts/model.json'))).evaluation_threshold));
  writeFileSync(file, contents.trimStart(), { mode: 0o600 });
  chmodSync(file, 0o600);
}
const plugin = spawnSync('docker', ['--context', context, 'compose', 'version'], { stdio: 'ignore' }).status === 0;
const executable = plugin ? 'docker' : 'docker-compose';
const base = [...(plugin ? ['--context', context, 'compose'] : ['--context', context]), '--env-file', file, '-f', 'compose.local.yml'];
if (process.env.SENTINEL_STACK_NAME) base.push('--project-name', process.env.SENTINEL_STACK_NAME);
if (action === 'up') {
  run(executable, [...base, 'up', '--build', '--wait', '--wait-timeout', '300', '-d']);
  configureLocal(values.LOCAL_LAB_HOST_TOKEN, context, Number(values.LOCAL_API_PORT));
  startHost();
  console.log(`\nSentinel local: http://localhost:${values.LOCAL_FRONTEND_PORT}\nAPI: http://localhost:${values.LOCAL_API_PORT}\nCredentials: npm run local:credentials\nAllow 60–90 seconds for the first real SDN measurements.\nStop this checkout's stack and lab host with npm run local:down.`);
} else {
  if (action === 'down') { await drainLocal(); stopHost(); }
  run(executable, [...base, ...({ down: ['down'], status: ['ps'], logs: ['logs', '--tail', '100', '-f'] }[action])]);
}
