'use strict';
const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const data=require('../src/report/deckDataV5');
const html=require('../src/report/deckHtmlV5C');
const report=require('../src/report/deckReportV5C');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
(async()=>{
  assert.equal(sha(html.OFFICIAL_LOGO_PATH),html.OFFICIAL_LOGO_SHA256);
  const assets=html.loadAssets();
  assert.deepEqual(Object.keys(assets),html.ASSET_FILES);
  assert.equal(Object.keys(assets).length,8);
  for(const a of Object.values(assets))assert.match(a.uri,/^data:image\/png;base64,/i);
  for(const kind of ['week','month']){
    const d=await data.build({kind,asOf:'2026-07-13'});
    assert.equal(d.schemaVersion,5);
    assert.equal(d.slideMap.length,38);
    assert.deepEqual(d.regionalScope,['Đồng Nai','Bình Phước']);
    if(kind==='week'){
      assert.deepEqual(d.period.current,{from:'2026-07-06',to:'2026-07-11'});
      assert.equal(d.totals.companyRevenue,10554785681);
      assert.equal(d.quality.comparisonValid,false);
    }else{
      assert.deepEqual(d.period.current,{from:'2026-06-01',to:'2026-06-30'});
      assert.equal(d.totals.companyRevenue,28403136096);
    }
    assert.equal(d.qlnb.sourceRows,2741);
    assert.equal(d.qlnb.stats.multiQlnbGroups,122);
    assert.equal(d.qlnb.queuedRows,44);
    assert.equal(d.qlnb.queuedAmount,9440828476);
    assert.equal(d.qlnb.distinctProductCount,18);
    assert.equal(d.qlnb.fullDetail.length,44);
    const doc=html.render(d),q=report.inspect(doc);
    assert.equal(q.slides,38);
    assert.equal(q.logos,38);
    assert.equal(q.protectedHeaderLogos,36);
    assert(q.officialLogo);
    assert.equal(q.qlnbProductCards,18);
    assert.equal(q.qlnbUnique,18);
    assert.equal(q.fullDetailRows,44);
    assert.equal(q.ellipsisCount,0);
    assert.equal(q.visualSlides,18);
    assert(q.visualSlides>=14&&q.visualSlides<=18);
    assert.deepEqual(q.visualAssets.sort(),html.ASSET_FILES.slice().sort());
    assert(Object.values(q.assetUsage).every(n=>n>=1));
    assert(q.selfContainedVisuals);
    assert.deepEqual(q.remoteImageUrls,[]);
    assert.equal((doc.match(/data-v5c-asset=/g)||[]).length,18);
    assert.equal((doc.match(/<figure class="v5cVisual[\s\S]*?<img src="data:image\/png;base64,/g)||[]).length,18);
    assert.equal((doc.match(/<img[^>]+alt="[^"]{20,}"/g)||[]).length>=56,true);
    assert(doc.includes('DRAFT V5C IMAGES'));
    assert(doc.includes('Đồng Nai vs Bình Phước'));
    assert(!doc.includes('TP. Hồ Chí Minh — đào sâu'));
    assert(!doc.includes('Bà Rịa - Vũng Tàu — đào sâu'));
  }
  console.log('OK CEO Deck V5C data/html: 38 slides/deck, official logo throughout, 18 image slides, all 8 approved local assets embedded as data URIs, canonical V5 facts and all QLNB detail retained');
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
