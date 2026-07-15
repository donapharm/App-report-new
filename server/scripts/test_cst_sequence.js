'use strict';
const assert = require('assert');
const store = require('../src/store');
const A = require('../src/analytics');
const S = require('../src/cstSequence');
const row=(x)=>({unit_code:'U1',product_name:'Thuốc A',uom:'Viên',bid_qty_initial:100,remain_qty:100,sold_qty:0,remain_pct:100,remain_amount:1000,...x});
{
  const r=S.classifyCstSequence([row({iit_code:'OLD',remain_qty:20,sold_qty:80,remain_pct:20,remain_amount:200}),row({iit_code:'NEXT'})]);
  assert.equal(r[0].cst_sequence.state,S.STATES.ACTIVE); assert.equal(r[1].cst_sequence.state,S.STATES.QUEUED);
  assert.equal(r[1].cst_sequence.current.code,'OLD'); assert.equal(r[1].cst_sequence.current.remainQty,20);
  assert.equal(r[1].cst_sequence.next.code,'NEXT');
}
{
  const r=S.classifyCstSequence([row({iit_code:'A'}),row({iit_code:'B'})]);
  assert(r.every(x=>x.cst_sequence.state===S.STATES.NEEDS_CONFIRMATION));
}
{
  const r=S.classifyCstSequence([row({iit_code:'OLD',remain_qty:0,sold_qty:100,remain_pct:0}),row({iit_code:'NEXT'})]);
  assert.equal(r[1].cst_sequence.state,S.STATES.ACTIONABLE);
}
// Scope isolation: classify only rows already returned for the employee.
{
  const mine=store.getCst({scope:{empCode:'DN005'}}); const classified=S.classifyCstSequence(mine);
  assert.equal(classified.length,mine.length); assert(classified.every(r=>String(r.emp_code||'').toUpperCase()==='DN005'||String(r.sales_emps||'').toUpperCase().split(',').includes('DN005')));
}
const all=A.cstTable({scope:{},filters:{}}),stats=S.sequenceStats(all);
assert.equal(stats.rows,2741);
// Conflicting raw UOM labels are canonicalized only when a shared QLNB family suffix
// supplies concrete identity evidence; this reproduces the approved baseline exactly.
assert.deepEqual({groups:stats.multiQlnbGroups,queued:stats.queuedRows,amount:stats.queuedAmount},{groups:122,queued:44,amount:9440828476});
const p=all.filter(r=>r.unit_code==='002.BVĐK Thống Nhất ĐN'&&r.product_name==='Parazacol 750');
const active=p.find(r=>r.iit_code==='G1.GE.QĐ139.2629.N4.56'),queued=p.find(r=>r.iit_code==='G1.GE.QĐ139.3204.N5.56');
assert(active&&queued);assert.equal(active.cst_sequence.state,S.STATES.ACTIVE);assert.equal(active.remain_pct,1.5);assert.equal(active.remain_qty,1352);assert.equal(active.remain_amount,39072800);assert.equal(queued.cst_sequence.state,S.STATES.QUEUED);assert.equal(queued.remain_qty,100000);assert.equal(queued.remain_amount,2890000000);
const actionable=A.cstTable({scope:{},filters:{status:'empty'}});assert(!actionable.some(r=>r.cst_sequence.state===S.STATES.QUEUED));
// Reproduce the previous audit (unit+product, without UOM) exactly to make the
// data-quality divergence explicit rather than silently changing the key.
const groups=new Map();for(const r of all){const k=[S.normalizeText(r.unit_code),S.normalizeProductName(r.product_name)].join('::'),a=groups.get(k)||[];a.push(r);groups.set(k,a)}
const multi=[...groups.values()].filter(a=>new Set(a.map(r=>r.iit_code)).size>1),legacyQueued=multi.flatMap(a=>a.some(S.isPartial)?a.filter(S.isFull):[]);
assert.deepEqual({groups:multi.length,queued:legacyQueued.length,amount:legacyQueued.reduce((s,r)=>s+Number(r.remain_amount||0),0)},{groups:122,queued:44,amount:9440828476});
console.log('OK CST sequence: canonical UOM key, exact 122/44/9,440,828,476 baseline, Parazacol, queued exclusion, ambiguity, scope isolation');
