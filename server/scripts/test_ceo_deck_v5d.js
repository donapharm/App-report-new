'use strict';
const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const data=require('../src/report/deckDataV5');
const v3=require('../src/report/deckDataV3');
const html=require('../src/report/deckHtmlV5D');
const report=require('../src/report/deckReportV5D');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const fold=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('vi').replace(/\s+/g,' ').trim();
(async()=>{
  assert.equal(sha(html.OFFICIAL_LOGO_PATH),html.OFFICIAL_LOGO_SHA256);
  const assets=html.loadAssets(),source=JSON.parse(fs.readFileSync(html.SOURCE_MANIFEST_PATH)),aiSource=JSON.parse(fs.readFileSync(html.AI_SOURCE_MANIFEST_PATH)),original=JSON.parse(fs.readFileSync(html.ORIGINAL_SOURCE_MANIFEST_PATH));
  assert.deepEqual(Object.keys(assets),html.ASSET_FILES);assert.equal(Object.keys(assets).length,14);assert.equal(source.count,20);assert.equal(aiSource.count,6);assert.equal(original.count,20);
  assert.match(source.sourceUrl,/1drv\.ms/);assert.match(source.transformation,/no generative/i);
  assert.deepEqual(html.REAL_ASSET_FILES.map(x=>assets[x].sha256).sort(),source.assets.filter(x=>html.REAL_ASSET_FILES.includes(x.asset)).map(x=>x.assetSha256).sort());
  assert.deepEqual(html.AI_ASSET_FILES.map(x=>assets[x].sha256).sort(),aiSource.assets.map(x=>x.assetSha256).sort());
  assert.deepEqual(source.assets.map(x=>x.sourceSha256).sort(),original.files.map(x=>x.sha256).sort());
  for(const a of Object.values(assets))assert.match(a.uri,/^data:image\/jpeg;base64,/i);
  assert.deepEqual(v3.contractorIdentity({contractor_name:'  Afp   Pharma  '}),{key:'LEGAL:AFP-PHARMA',label:'AFP PHARMA'});
  assert.deepEqual(v3.contractorIdentity({contractor_name:' donapharm '}),{key:'LEGAL:DONAPHARM',label:'DONAPHARM'});
  assert.equal(v3.contractorIdentity({contractor_name:'Công Ty  ABC'}).key,v3.contractorIdentity({contractor_name:' công ty abc '}).key);
  assert.equal(v3.contractorIdentity({contractor_name:'Công Ty  ABC'}).label,v3.contractorIdentity({contractor_name:' công ty abc '}).label);
  for(const kind of ['week','month']){
    const d=await data.build({kind,asOf:'2026-07-13'});assert.equal(d.schemaVersion,5);assert.equal(d.slideMap.length,38);assert.deepEqual(d.regionalScope,['Đồng Nai','Bình Phước']);
    const contractors=d.dimensions.contractor,group=contractors.filter(x=>['LEGAL:DONAPHARM','LEGAL:AFP-PHARMA'].includes(x.key));
    assert.equal(group.length,2);assert.deepEqual(group.map(x=>x.label).sort(),['AFP PHARMA','DONAPHARM']);
    const reconciliation=report.supplierReconciliation(d);assert.equal(reconciliation.groupDonaEntityCount,2);assert.equal(reconciliation.duplicateCanonicalKeys,0);assert.equal(reconciliation.duplicateCanonicalLabels,0);
    assert.equal(new Set(contractors.map(x=>fold(x.label))).size,contractors.length,'duplicate supplier labels after case/whitespace fold');
    assert(!contractors.some(x=>/^Afp Pharma$/i.test(x.label)&&x.label!=='AFP PHARMA'));assert(!contractors.some(x=>/\s{2,}/.test(x.label)));
    if(kind==='week'){
      assert.deepEqual(d.period.current,{from:'2026-07-06',to:'2026-07-11'});assert.equal(d.totals.companyRevenue,10554785681);assert.equal(d.quality.comparisonValid,false);
      assert.equal(group.find(x=>x.key==='LEGAL:DONAPHARM').revenue,3792635096);assert.equal(group.find(x=>x.key==='LEGAL:AFP-PHARMA').revenue,3129937445);assert.equal(group.reduce((s,x)=>s+x.revenue,0),6922572541);
    }else{
      assert.deepEqual(d.period.current,{from:'2026-06-01',to:'2026-06-30'});assert.equal(d.totals.companyRevenue,28403136096);
      assert.equal(group.find(x=>x.key==='LEGAL:DONAPHARM').revenue,10593941804);assert.equal(group.find(x=>x.key==='LEGAL:AFP-PHARMA').revenue,8232847232);assert.equal(group.reduce((s,x)=>s+x.revenue,0),18826789036);
    }
    assert.equal(d.qlnb.sourceRows,2741);assert.equal(d.qlnb.stats.multiQlnbGroups,122);assert.equal(d.qlnb.queuedRows,44);assert.equal(d.qlnb.queuedAmount,9440828476);assert.equal(d.qlnb.distinctProductCount,18);assert.equal(d.qlnb.fullDetail.length,44);
    const doc=html.render(d),q=report.inspect(doc);assert.equal(q.slides,38);assert.equal(q.logos,38);assert.equal(q.protectedHeaderLogos,36);assert(q.officialLogo);assert.equal(q.qlnbProductCards,18);assert.equal(q.qlnbUnique,18);assert.equal(q.fullDetailRows,44);assert.equal(q.ellipsisCount,0);
    const map=html.visualMapFor(d),expected=[...new Set(Object.values(map).flatMap(x=>x[0]))].sort();
    assert.equal(q.photoSlides,7);assert.equal(q.photoAssets.length,7);assert.equal(q.photoEmbeds,7);assert.equal(q.realPhotoEmbeds,4);assert.equal(q.aiDecorativeEmbeds,3);assert.deepEqual(q.photoAssets.sort(),expected);assert(Object.values(q.assetUsage).every(n=>n===1));assert(q.selfContainedVisuals);assert.deepEqual(q.remoteImageUrls,[]);
    assert(doc.includes(html.GENERIC_ALT));assert(doc.includes(html.AI_ALT));assert(doc.includes('DRAFT V5D PHOTO LIGHT'));assert(!doc.includes('Afp Pharma'));
    const allowed=new Set([html.OFFICIAL_LOGO_SHA256,...html.REAL_ASSET_FILES.map(x=>assets[x].sha256),...html.AI_ASSET_FILES.map(x=>assets[x].sha256)]);const embedded=[...doc.matchAll(/src="data:image\/(?:png|jpeg);base64,([^"]+)"/g)].map(x=>crypto.createHash('sha256').update(Buffer.from(x[1],'base64')).digest('hex'));assert.equal(embedded.length,45);assert(embedded.every(x=>allowed.has(x)),'embedded image outside approved CEO-photo + AI-decorative + logo allowlist');
  }
  const weekUsed=new Set(Object.values(html.VISUAL_MAPS.week).flatMap(x=>x[0])),monthUsed=new Set(Object.values(html.VISUAL_MAPS.month).flatMap(x=>x[0]));assert.equal([...weekUsed].filter(x=>monthUsed.has(x)).length,0,'week/month image sets must be disjoint');
  console.log('OK CEO Deck V5D photo-light data/html: 2x38 slides, 7 images/deck (4 CEO + 3 AI), disjoint rotation, official logo 38/38, canonical legal entities and QLNB facts retained');
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
