'use strict';

const TZ = 'Asia/Ho_Chi_Minh';

function vnSecond(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second} GMT+7`;
}

function startTick(task, { now = new Date(), startNs = process.hrtime.bigint(), log = console.log } = {}) {
  let finished = false;
  return ({ didWork, outcome }) => {
    if (finished) return null;
    finished = true;
    const durationMs = Math.round(Number(process.hrtime.bigint() - startNs) / 1e5) / 10;
    const record = { at: vnSecond(now), durationMs, didWork: didWork === true, outcome: String(outcome || 'unknown') };
    log(`[${task}-tick] ${JSON.stringify(record)}`);
    return record;
  };
}

module.exports = { vnSecond, startTick };
