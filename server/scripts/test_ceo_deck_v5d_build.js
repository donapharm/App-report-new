'use strict';
const assert=require('assert');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const html=require('../src/report/deckHtmlV5D');
const {OUT_DIR,VERIFY_DIR}=require('../src/report/deckReportV5D');
const ROOT=path.join(__dirname,'..','..');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const source=JSON.parse(fs.readFileSync(html.SOURCE_MANIFEST_PATH));
const aiSource=JSON.parse(fs.readFileSync(html.AI_SOURCE_MANIFEST_PATH));
for(const kind of ['week','month']){
  const mf=fs.readdirSync(OUT_DIR).find(f=>f.endsWith('.manifest.json')&&f.includes(kind==='week'?'TUAN':'THANG'));assert(mf,`missing ${kind}`);
  const m=JSON.parse(fs.readFileSync(path.join(OUT_DIR,mf))),count=m.slideMap.length;assert.equal(m.schemaVersion,5.3);assert.equal(m.kind,kind);assert.equal(count,38);assert.equal(m.slides,38);
  assert.equal(m.structure.logos,38);assert.equal(m.structure.protectedHeaderLogos,36);assert(m.structure.officialLogo);assert.equal(m.structure.qlnbProductCards,18);assert.equal(m.structure.fullDetailRows,44);
  assert.equal(m.qlnb.sourceRows,2741);assert.equal(m.qlnb.multiQlnbGroups,122);assert.equal(m.qlnb.queuedRows,44);assert.equal(m.qlnb.queuedAmount,9440828476);assert.equal(m.qlnb.distinctProductCount,18);assert.equal(m.qlnb.fullDetailRows,44);
  const map=html.VISUAL_MAPS[kind],expected=[...new Set(Object.values(map).flatMap(x=>x[0]))].sort();assert.equal(m.visualSystem.imageSlideCount,7);assert.equal(m.visualSystem.targetImagesPerDeck,7);assert.equal(m.visualSystem.ceoPhotoCount,4);assert.equal(m.visualSystem.aiDecorativeCount,3);assert.equal(m.visualSystem.assets.length,7);assert.deepEqual(m.visualSystem.assets.map(x=>x.name).sort(),expected);assert(m.visualSystem.assets.every(x=>x.uses===1));assert.equal(m.visualSystem.assets.filter(x=>x.type==='CEO_PHOTO').length,4);assert.equal(m.visualSystem.assets.filter(x=>x.type==='AI_DECORATIVE').length,3);assert(m.visualSystem.selfContainedDataUris);assert.deepEqual(m.visualSystem.remoteImageUrls,[]);assert.equal(m.visualSystem.brokenImages,0);
  const r=m.supplierReconciliation;assert.equal(r.groupDonaEntityCount,2);assert.equal(r.duplicateLabelsAfterCaseWhitespaceFold,0);assert.equal(r.visibleAfpTitleCaseVariant,false);
  if(kind==='month'){assert.equal(r.companyTotal,28403136096);assert.equal(r.donapharmRevenue,10593941804);assert.equal(r.afpPharmaRevenue,8232847232);assert.equal(r.groupDonaTotal,18826789036)}else{assert.equal(r.companyTotal,10649681681);assert.equal(r.donapharmRevenue,3792635096);assert.equal(r.afpPharmaRevenue,3224833445);assert.equal(r.groupDonaTotal,7017468541)}
  assert.equal(m.qa.automatedResult,'PASS');assert.equal(m.qa.browserCollisionIssues,0);assert.equal(m.qa.consoleErrors,0);assert.deepEqual(m.qa.duplicateWithinDeck,[]);assert.equal(m.qa.ledger.rows,38);
  for(const type of ['html','pptx']){const f=path.join(OUT_DIR,m.files[type].name);assert(fs.existsSync(f));assert.equal(fs.statSync(f).size,m.files[type].bytes);assert.equal(sha(f),m.files[type].sha256);assert(m.files[type].name.endsWith(`_DRAFT_V5D_PHOTO_LIGHT.${type}`)||type==='html'&&m.files[type].name.endsWith('_DRAFT_V5D_PHOTO_LIGHT.html'))}
  const htmlPath=path.join(OUT_DIR,m.files.html.name),text=fs.readFileSync(htmlPath,'utf8');assert.equal((text.match(/data-v5d-slide=/g)||[]).length,7);assert.equal((text.match(/data-v5d-asset=/g)||[]).length,7);assert.equal((text.match(/data-v5d-asset-type="CEO_PHOTO"/g)||[]).length,4);assert.equal((text.match(/data-v5d-asset-type="AI_DECORATIVE"/g)||[]).length,3);assert.equal((text.match(/<img[^>]+src="https?:/g)||[]).length,0);assert(!text.includes('Afp Pharma'));
  const allowed=new Set([html.OFFICIAL_LOGO_SHA256,...source.assets.map(x=>x.assetSha256),...aiSource.assets.map(x=>x.assetSha256)]);const embedded=[...text.matchAll(/src="data:image\/(?:png|jpeg);base64,([^"]+)"/g)].map(x=>crypto.createHash('sha256').update(Buffer.from(x[1],'base64')).digest('hex'));assert.equal(embedded.length,45);assert(embedded.every(x=>allowed.has(x)));
  const pptx=path.join(OUT_DIR,m.files.pptx.name);execFileSync('unzip',['-t',pptx],{stdio:'ignore'});const names=execFileSync('unzip',['-Z1',pptx],{encoding:'utf8'}).trim().split('\n');assert.equal(names.filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,38);assert.equal(names.filter(n=>/^ppt\/media\/.*\.png$/.test(n)).length,38);
  const imageDir=path.join(ROOT,m.files.images.directory),imgs=fs.readdirSync(imageDir).filter(x=>x.endsWith('.png'));assert.equal(imgs.length,38);for(const f of imgs){const sig=fs.readFileSync(path.join(imageDir,f));assert.equal(sig.readUInt32BE(16),1920);assert.equal(sig.readUInt32BE(20),1080)}
  const focused=path.join(ROOT,m.files.photoRich.sheet.path);assert(fs.existsSync(focused));assert.equal(m.files.photoRich.count,7);assert.equal(sha(focused),m.files.photoRich.sheet.sha256);
}
const summary=JSON.parse(fs.readFileSync(path.join(OUT_DIR,'CEO_DECK_V5D_PHOTO_LIGHT_DRAFT_ARTIFACT_MANIFEST.json')));assert.equal(summary.qa,'AUTOMATED_PASS_MANUAL_REVIEW_RECOMMENDED');assert.equal(summary.decks.length,2);assert(summary.decks.every(x=>x.slides===38&&x.imageSlideCount===7&&x.ceoPhotoCount===4&&x.aiDecorativeCount===3));assert.equal(summary.ledgerRows,76);assert.equal(summary.artifacts.length,4);
const use=JSON.parse(fs.readFileSync(path.join(VERIFY_DIR,'SOURCE_USE_MANIFEST.json')));assert.equal(use.assets.length,14);assert.equal(use.policy.imagesPerDeck,7);assert.equal(use.policy.ceoPhotosPerDeck,4);assert.equal(use.policy.aiDecorativePerDeck,3);assert.equal(use.policy.aiFactualEvidence,false);assert.equal(use.policy.repeatAcrossWeekMonth,false);assert(use.assets.every(x=>Boolean(x.weekSlides.length)!==Boolean(x.monthSlides.length)));assert.equal(use.allowedOfficialAssets[0].sha256,html.OFFICIAL_LOGO_SHA256);
console.log('OK CEO Deck V5D photo-light build: 2x38 slides, 7 images/deck (4 CEO + 3 AI), disjoint rotation, PPTX/PNG/source hashes, logo 38/38, no geometry/console/duplicate slide issues');
