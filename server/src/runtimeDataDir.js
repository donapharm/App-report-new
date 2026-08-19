const fs = require('fs');
const path = require('path');

const ENV_FILE_MARKER = 'APP_REPORT_ENV_FILE';

function markLoadedEnvFile(envFile, env = process.env) {
  const resolved = fs.realpathSync(envFile);
  env[ENV_FILE_MARKER] = resolved;
  return resolved;
}

function resolveAuthDataDir({ env = process.env, fallbackDir } = {}) {
  const explicit = String(env.AUTH_DATA_DIR || '').trim();
  if (explicit) return path.resolve(explicit);

  const envFile = String(env[ENV_FILE_MARKER] || '').trim();
  if (envFile) {
    const canonicalEnvFile = fs.realpathSync(envFile);
    return path.join(path.dirname(canonicalEnvFile), 'server', 'data', 'auth');
  }

  return path.resolve(fallbackDir || path.join(__dirname, '..', 'data', 'auth'));
}

module.exports = { ENV_FILE_MARKER, markLoadedEnvFile, resolveAuthDataDir };
