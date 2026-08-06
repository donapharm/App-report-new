const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'run_due_jobs.js');
const SOURCE = fs.readFileSync(SCRIPT, 'utf8');

test('runner tôn trọng hai luật cứng của V-D', () => {
  // 1. TUYỆT ĐỐI không tự áp target — handler target_proposal chỉ ghi log.
  assert.match(SOURCE, /không áp target/i);
  assert.doesNotMatch(SOURCE, /targetAdmin|saveTarget|applyTarget/);
  // 2. payment_notice cố ý KHÔNG có handler ⇒ không bị đánh dấu "đã chạy" khi chưa làm gì.
  assert.doesNotMatch(SOURCE, /payment_notice:\s*async/);
});

test('--dry-run liệt kê việc, không ghi state', () => {
  const before = fs.existsSync(path.join(__dirname, '..', 'data', 'auth', 'scheduled_jobs_state.json'))
    ? fs.readFileSync(path.join(__dirname, '..', 'data', 'auth', 'scheduled_jobs_state.json'), 'utf8') : null;
  const out = execFileSync(process.execPath, [SCRIPT, '--dry-run'], { encoding: 'utf8' });
  assert.match(out, /DRY-RUN/);
  assert.match(out, /Chưa chạy gì, chưa ghi state/);
  const after = fs.existsSync(path.join(__dirname, '..', 'data', 'auth', 'scheduled_jobs_state.json'))
    ? fs.readFileSync(path.join(__dirname, '..', 'data', 'auth', 'scheduled_jobs_state.json'), 'utf8') : null;
  assert.equal(after, before, 'dry-run không được đụng state file');
});
