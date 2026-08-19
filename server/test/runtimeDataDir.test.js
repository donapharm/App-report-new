const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ENV_FILE_MARKER, markLoadedEnvFile, resolveAuthDataDir } = require('../src/runtimeDataDir');

test('release symlink .env resolves auth state outside the immutable release', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'report-runtime-root-'));
  const canonical = path.join(root, 'canonical');
  const release = path.join(root, 'release');
  fs.mkdirSync(canonical);
  fs.mkdirSync(release);
  fs.writeFileSync(path.join(canonical, '.env'), 'PORT=0\n');
  fs.symlinkSync(path.join(canonical, '.env'), path.join(release, '.env'));

  const env = {};
  markLoadedEnvFile(path.join(release, '.env'), env);

  assert.equal(env[ENV_FILE_MARKER], path.join(canonical, '.env'));
  assert.equal(resolveAuthDataDir({ env }), path.join(canonical, 'server', 'data', 'auth'));
  assert.notEqual(resolveAuthDataDir({ env }), path.join(release, 'server', 'data', 'auth'));
});

test('explicit AUTH_DATA_DIR keeps temporary instances isolated', () => {
  const explicit = path.join(os.tmpdir(), 'report-isolated-auth');
  const env = { AUTH_DATA_DIR: explicit, [ENV_FILE_MARKER]: '/must/not/win/.env' };
  assert.equal(resolveAuthDataDir({ env }), explicit);
});

test('direct source run without env file keeps the local fallback', () => {
  const fallback = path.join(os.tmpdir(), 'report-local-auth');
  assert.equal(resolveAuthDataDir({ env: {}, fallbackDir: fallback }), fallback);
});

test('backend and telegram worker mark env before loading persistence', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  const bot = fs.readFileSync(path.join(__dirname, '..', 'telegram-bot.js'), 'utf8');
  assert.ok(index.indexOf('markLoadedEnvFile(p)') < index.indexOf("require('./routes')"));
  assert.ok(bot.indexOf('markLoadedEnvFile(p)') < bot.indexOf("require('./src/persist')"));
  assert.match(bot, /path\.join\(persist\.DIR, 'telegram_pending_grants\.json'\)/);
});
