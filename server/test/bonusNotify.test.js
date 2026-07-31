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

test('DN022 không thể lọt qua mốc thưởng hay tin thưởng cuối tháng', (t) => {
  freshState(t);
  const result = bonusNotify.pendingEvents({
    ky: '07.2026', rows: [row({ emp_code: 'DN022', pct: 150, achieved: 750_000_000 })], config: REAL_CONFIG,
  });
  assert.equal(result.events.length, 0);
  assert.equal(bonusNotify.monthEndMessage(
    { emp_code: 'DN022', name: 'CTV 22', ky: '07.2026', pct: 150 },
    { baseAmount: 10_000_000, priorityAmount: 20_000_000 },
  ), null);
});

test('DN002/DN004 bị chặn riêng khỏi tin thưởng tiền nhưng không cần đưa vào optout chung', (t) => {
  freshState(t);
  for (const emp_code of ['DN002', 'DN004']) {
    const result = bonusNotify.pendingEvents({
      ky: '07.2026', rows: [row({ emp_code, pct: 150, achieved: 750_000_000 })], config: REAL_CONFIG,
    });
    assert.equal(result.events.length, 0, `${emp_code} không sinh mốc thưởng`);
    assert.equal(bonusNotify.monthEndMessage(
      { emp_code, name: emp_code, ky: '07.2026', pct: 150 },
      { baseAmount: 10_000_000, priorityAmount: 20_000_000 },
    ), null, `${emp_code} không sinh tin thưởng cuối tháng`);
  }
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
  // CEO chốt 30/07: tin 20:00 cuối tháng VẪN GỬI nhưng phải nói rõ CHƯA CHỐT, kèm
  // ngày khoá sổ và lời hứa gửi lại số chốt — không để NV tưởng đây là số cuối.
  assert.match(text, /thưởng DỰ KIẾN tháng/);
  assert.match(text, /Số DỰ KIẾN, CHƯA CHỐT/);
  assert.match(text, /gửi lại số chốt/);
  assert.match(text, /[Kk]hông phải bảng lương/);
});

test('lượt sau khoá sổ: tin đổi thành SỐ CHỐT, bỏ hẳn chữ dự kiến', () => {
  const employeeCost = require('../src/employeeCost');
  const row = { emp_code: 'DN006', name: 'Trần B', ky: '07.2026', pct: 112.4, target: 1_000_000_000, achieved: 1_124_000_000 };
  const bonus = { baseAmount: 3_120_000, priorityAmount: 5_479_768 };
  const provisional = bonusNotify.monthEndMessage(row, bonus, {
    stage: 'provisional', closeNote: employeeCost.periodCloseNote('2026-07', '2026-07-31'),
  });
  assert.match(provisional, /còn cập nhật đến hết ngày 08\/08\/2026/);

  const final = bonusNotify.monthEndMessage(row, bonus, {
    stage: 'final', closeNote: employeeCost.periodCloseNote('2026-07', '2026-08-09'),
  });
  assert.match(final, /thưởng CHỐT tháng/);
  assert.match(final, /Tổng chốt: 8\.599\.768đ/);
  assert.match(final, /Số CHÍNH THỨC của kỳ/);
  assert.match(final, /đã khoá sổ hết ngày 08\/08\/2026/);
  assert.doesNotMatch(final, /DỰ KIẾN/, 'tin chốt không được còn chữ dự kiến');
});

test('bộ hẹn giờ có lượt gửi SỐ CHỐT sau ngày khoá sổ, tách khoá chống trùng theo stage', () => {
  const fs = require('fs');
  const path = require('path');
  const bot = fs.readFileSync(path.join(__dirname, '..', 'telegram-bot.js'), 'utf8');
  // Ngày lượt chốt phải suy từ employeeCost.PERIOD_CLOSE_DAY, không ghi cứng số 9.
  assert.match(bot, /const MONTH_CLOSE_DAY = employeeCost\.PERIOD_CLOSE_DAY \+ 1;/);
  assert.match(bot, /COST_MONTH_FINAL_SLOT = \{ hour: 20, minute: 0/);
  assert.match(bot, /BONUS_MONTH_FINAL_SLOT = \{ hour: 20, minute: 10/);
  // Lượt chốt gửi cho kỳ VỪA KHOÁ = tháng TRƯỚC, không phải tháng đang chạy.
  assert.match(bot, /closedPeriodAsOf = isCloseDay \? isoDay\(new Date\(Date\.UTC\(d\.getUTCFullYear\(\), d\.getUTCMonth\(\), 0\)\)\) : ''/);
  assert.match(bot, /stage: 'final'/);
  // Hai lượt là HAI tin khác nhau: khoá chống gửi trùng phải mang stage.
  assert.match(bot, /bonus_month\|\$\{monthKey\}\|\$\{stage\}/);
  assert.match(bot, /kind === 'month' \? `\|\$\{stage\}` : ''/);
});

test('không có số thưởng hợp lệ -> trả null, KHÔNG bịa 0đ', () => {
  assert.equal(bonusNotify.monthEndMessage({ ky: '07.2026' }, {}), null);
  assert.equal(bonusNotify.monthEndMessage({ ky: '07.2026' }, { baseAmount: null, priorityAmount: null }), null);
});

test('‼ chưa tới ngưỡng (P1=0, P2=0) -> KHÔNG gửi tin "Tổng dự kiến: 0đ"', () => {
  // employeeBonus trả 0 (SỐ THẬT, không phải null) khi dưới ngưỡng, nên nhánh
  // null không chặn được. Không có chốt này thì ~15/21 NV nhận tin thưởng 0đ.
  assert.equal(bonusNotify.monthEndMessage(
    { emp_code: 'DN0XX', name: 'A', ky: '07.2026', pct: 1.8, target: 500_000_000, achieved: 9_237_714 },
    { baseAmount: 0, priorityAmount: 0 },
  ), null);
});

test('có tiền dù ít thì VẪN gửi — không được chặn nhầm người đã đạt ngưỡng', () => {
  const text = bonusNotify.monthEndMessage(
    { emp_code: 'DN003', name: 'B', ky: '07.2026', pct: 95, target: 100_000_000, achieved: 95_000_000 },
    { baseAmount: 95_000, priorityAmount: 0 },
  );
  assert.match(text, /P1 \(coach\): 95\.000đ/);
  assert.match(text, /Tổng dự kiến: 95\.000đ/);
});

test('chỉ có P2 mà không có P1 thì vẫn gửi', () => {
  const text = bonusNotify.monthEndMessage(
    { emp_code: 'DN006', name: 'C', ky: '07.2026', pct: 112 },
    { baseAmount: 0, priorityAmount: 5_479_768 },
  );
  assert.match(text, /Tổng dự kiến: 5\.479\.768đ/);
});
