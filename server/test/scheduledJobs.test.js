'use strict';
// ‼ Mọi mốc theo GIỜ VIỆT NAM. Lấy giờ máy thì 00:00–07:00 giờ VN ra NGÀY HÔM QUA
// ⇒ lịch "ngày 01" bắn nhầm sang ngày 31 tháng trước và neo nhầm tháng.
const test = require('node:test');
const assert = require('node:assert/strict');
const jobs = require('../src/scheduledJobs');

const memStore = () => ({ data: {}, load(n, d) { return this.data[n] ?? d; }, save(n, v) { this.data[n] = v; } });
// 2026-09-01 08:30 giờ VN = 2026-09-01T01:30Z
const day01 = new Date('2026-09-01T01:30:00Z');

test('‼ giờ VN, không phải giờ máy: 00:30 ngày 01 giờ VN vẫn là NGÀY 01', () => {
  // 2026-08-31T17:30Z = 2026-09-01 00:30 giờ VN.
  const parts = jobs.vnParts(new Date('2026-08-31T17:30:00Z'));
  assert.equal(parts.date, '2026-09-01');
  assert.equal(parts.month, '2026-09');
  assert.equal(parts.day, 1);
});

test('ngày 01 từ 08:00 ⇒ đề xuất target tháng mới, NEO tháng vừa kết thúc', () => {
  const due = jobs.dueJobs(day01, {});
  const proposal = due.find((item) => item.job === 'target_proposal');
  assert.ok(proposal, 'phải có việc đề xuất target ngay ngày 01');
  assert.equal(proposal.targetKy, '2026-09');
  assert.equal(proposal.anchorKy, '2026-08', 'neo doanh thu tháng vừa kết thúc');
  assert.equal(proposal.stage, 'open');
  assert.equal(proposal.closed, false, 'ngày 01 thì kỳ neo CHƯA khoá sổ');
});

test('trước 08:00 giờ VN thì chưa tới giờ', () => {
  assert.deepEqual(jobs.dueJobs(new Date('2026-08-31T23:30:00Z'), []), []);
});

test('ngày 09 ⇒ tính lại bằng số ĐÃ CHỐT', () => {
  const proposal = jobs.dueJobs(new Date('2026-09-09T01:30:00Z'), {}).find((item) => item.job === 'target_proposal');
  assert.equal(proposal.stage, 'closed');
  assert.equal(proposal.closed, true);
  assert.equal(proposal.anchorKy, '2026-08');
});

test('ngày thường chỉ có nhắc thanh toán, không đề xuất target', () => {
  const due = jobs.dueJobs(new Date('2026-09-15T01:30:00Z'), {});
  assert.deepEqual(due.map((item) => item.job), ['payment_notice']);
});

test('‼ mỗi mốc chỉ chạy MỘT lần — gọi lại trong ngày không chạy lại', async () => {
  const store = memStore();
  const calls = [];
  const handlers = { payment_notice: async () => calls.push('pay'), target_proposal: async (job) => calls.push(job.stage) };
  const first = await jobs.runDueJobs({ now: day01, handlers, store });
  assert.deepEqual(first.ran.length, 2);
  assert.deepEqual(calls, ['pay', 'open']);
  const second = await jobs.runDueJobs({ now: new Date('2026-09-01T09:00:00Z'), handlers, store });
  assert.deepEqual(second.jobs, [], 'trong ngày không lặp lại');
  assert.deepEqual(calls, ['pay', 'open']);
});

test('việc lỗi thì KHÔNG đánh dấu đã chạy — lần sau chạy lại', async () => {
  const store = memStore();
  let fail = true;
  const handlers = { payment_notice: async () => { if (fail) throw new Error('telegram down'); } };
  const first = await jobs.runDueJobs({ now: day01, handlers, store });
  assert.deepEqual(first.ran, []);
  assert.equal(first.failed.length, 1);
  fail = false;
  const second = await jobs.runDueJobs({ now: day01, handlers, store });
  assert.equal(second.ran.length, 1, 'phải chạy lại sau khi kênh hồi phục');
});

test('dryRun chỉ liệt kê, không chạy và không đánh dấu', async () => {
  const store = memStore();
  let called = 0;
  const result = await jobs.runDueJobs({ now: day01, handlers: { payment_notice: async () => { called += 1; } }, store, dryRun: true });
  assert.equal(called, 0);
  assert.deepEqual(result.ran, []);
  assert.deepEqual(jobs.readState(store), {});
});

test('lùi tháng bắc qua năm', () => {
  assert.equal(jobs.previousMonth('2027-01'), '2026-12');
  assert.equal(jobs.previousMonth('bậy'), '');
});
