'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const bonusNotify = require('../src/bonusNotify');

// Cấu hình THẬT đang chạy — dùng làm chuẩn để chứng minh nhãn P1/P2 không bị ngược.
const REAL_CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'employee_bonus_tiers.json'), 'utf8'));

function freshState(t) {
  const file = bonusNotify.STATE_FILE;
  const had = fs.existsSync(file);
  const backup = had ? fs.readFileSync(file, 'utf8') : null;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* ignore */ }
  fs.writeFileSync(file, '{}', 'utf8');
  t.after(() => { if (had) fs.writeFileSync(file, backup, 'utf8'); else { try { fs.unlinkSync(file); } catch { /* ignore */ } } });
}

const row = (over = {}) => ({ emp_code: 'DN001', name: 'Nguyễn Văn A', target: 500_000_000, achieved: 0, pct: 0, ...over });

test('mốc suy ra từ CẤU HÌNH THẬT: P1 bắt đầu 90, P2 bắt đầu 101 — KHÔNG phải 100/110', () => {
  const ms = bonusNotify.milestonesFromConfig(REAL_CONFIG);
  const p1First = ms.find((m) => m.kind === 'p1' && m.first);
  const p2 = ms.find((m) => m.kind === 'p2');
  assert.equal(p1First.pct, 90, 'P1 bắt đầu ở 90% (bậc đầu tiên có bonusPct > 0)');
  assert.equal(p2.pct, 101, 'P2 bắt đầu ở priorityThresholdPct = 101');
  // 4 mốc CEO chốt phải có đủ
  assert.deepEqual(ms.map((m) => m.pct), [90, 100, 101, 110, 130]);
});

test('đổi cấu hình thì mốc tự đổi theo — không hardcode trong code', () => {
  const ms = bonusNotify.milestonesFromConfig({
    baseTiers: [
      { fromPct: 0, toPct: 80, bonusPct: 0 },
      { fromPct: 80, toPct: null, bonusPct: 0.2 },
    ],
    priorityThresholdPct: 95,
  });
  assert.deepEqual(ms.map((m) => m.pct), [80, 95]);
  assert.equal(ms[0].kind, 'p1');
  assert.equal(ms[1].kind, 'p2');
});

test('cấu hình hỏng -> KHÔNG sinh sự kiện (fail-closed, thà im còn hơn nhắn sai tiền)', (t) => {
  freshState(t);
  for (const bad of [{}, { baseTiers: [] }, { baseTiers: [{ fromPct: 0, bonusPct: 0 }], priorityThresholdPct: null }]) {
    const r = bonusNotify.pendingEvents({ ky: '07.2026', rows: [row({ pct: 150 })], config: bad });
    assert.equal(r.events.length, 0);
    assert.equal(r.reason, 'bonus_config_unusable');
  }
});

test('mỗi mốc chỉ nhắn 1 lần/kỳ; qua nhiều mốc cùng lúc thì ra đủ sự kiện', (t) => {
  freshState(t);
  const first = bonusNotify.pendingEvents({ ky: '07.2026', rows: [row({ pct: 105 })], config: REAL_CONFIG });
  assert.deepEqual(first.events.map((e) => e.milestone.pct), [90, 100, 101]);

  bonusNotify.markSent(first.events);
  const again = bonusNotify.pendingEvents({ ky: '07.2026', rows: [row({ pct: 105 })], config: REAL_CONFIG });
  assert.equal(again.events.length, 0, 'đã gửi rồi thì không gửi lại');

  const higher = bonusNotify.pendingEvents({ ky: '07.2026', rows: [row({ pct: 112 })], config: REAL_CONFIG });
  assert.deepEqual(higher.events.map((e) => e.milestone.pct), [110], 'chỉ mốc mới vượt');
});

test('kỳ khác nhau đếm riêng — sang tháng mới nhắc lại từ đầu', (t) => {
  freshState(t);
  const jul = bonusNotify.pendingEvents({ ky: '07.2026', rows: [row({ pct: 95 })], config: REAL_CONFIG });
  bonusNotify.markSent(jul.events);
  const aug = bonusNotify.pendingEvents({ ky: '08.2026', rows: [row({ pct: 95 })], config: REAL_CONFIG });
  assert.deepEqual(aug.events.map((e) => e.milestone.pct), [90]);
});

test('thiếu nguồn chi phí hoặc bị chặn -> không sinh sự kiện', (t) => {
  freshState(t);
  const blocked = bonusNotify.pendingEvents({
    ky: '07.2026', rows: [row({ pct: 150 })], config: REAL_CONFIG, isMuted: () => true,
  });
  assert.equal(blocked.events.length, 0);

  const noSource = bonusNotify.pendingEvents({
    ky: '07.2026', rows: [row({ pct: 150, sourceAvailable: false })], config: REAL_CONFIG,
  });
  assert.equal(noSource.events.length, 0, 'không hứa tiền khi dữ liệu chưa đủ');
});

test('tin mốc P2 nói ĐÚNG bản chất, không gọi nhầm 110% là P2', (t) => {
  freshState(t);
  const { events } = bonusNotify.pendingEvents({ ky: '07.2026', rows: [row({ pct: 115, achieved: 575_000_000 })], config: REAL_CONFIG });
  const texts = Object.fromEntries(events.map((e) => [`${e.milestone.kind}${e.milestone.pct}`, bonusNotify.messageFor(e)]));

  assert.match(texts.p190, /BẮT ĐẦU có thưởng P1/);
  assert.match(texts.p2101, /BẮT ĐẦU có thêm thưởng ưu tiên P2/);
  assert.doesNotMatch(texts.p1110 || '', /P2/, 'mốc 110% là P1 lên bậc, tuyệt đối không được ghi là P2');
  assert.match(texts.p1110, /P1 lên mức/);
});

test('tin tổng thưởng cuối tháng: có đủ P1 + P2 + tổng, và ghi rõ là DỰ KIẾN', () => {
  const text = bonusNotify.monthEndMessage(
    { emp_code: 'DN006', name: 'Trần B', ky: '07.2026', pct: 112.4, target: 1_000_000_000, achieved: 1_124_000_000 },
    { baseAmount: 3_120_000, priorityAmount: 5_479_768 },
  );
  assert.match(text, /P1 \(coach\): 3\.120\.000đ/);
  assert.match(text, /P2 \(ưu tiên C10\): 5\.479\.768đ/);
  assert.match(text, /Tổng dự kiến: 8\.599\.768đ/);
  assert.match(text, /DỰ KIẾN.*không phải bảng lương/);
});

test('không có số thưởng hợp lệ -> trả null, KHÔNG bịa 0đ', () => {
  assert.equal(bonusNotify.monthEndMessage({ ky: '07.2026' }, {}), null);
  assert.equal(bonusNotify.monthEndMessage({ ky: '07.2026' }, { baseAmount: null, priorityAmount: null }), null);
});
