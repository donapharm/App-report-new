'use strict';
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const v5=require('./deckHtmlV5');

const ROOT=path.join(__dirname,'..','..','..');
const ASSET_DIR=path.join(ROOT,'web','public','report-assets','v5c');
const ASSET_FILES=[
  'cover-pharma-intelligence.png',
  'regional-healthcare-network.png',
  'pharma-sales-team.png',
  'product-portfolio.png',
  'qlnb-sequence.png',
  'hospital-customer-network.png',
  'data-points-xu.png',
  'executive-action.png',
];
const ASSET_ALT={
  'cover-pharma-intelligence.png':'Pharmaceutical intelligence workspace connecting medicine, analytics and executive decisions',
  'regional-healthcare-network.png':'Regional healthcare network connecting Đồng Nai and Bình Phước facilities',
  'pharma-sales-team.png':'Professional pharmaceutical sales team reviewing field performance',
  'product-portfolio.png':'Premium pharmaceutical product portfolio and treatment categories',
  'qlnb-sequence.png':'QLNB medicine-code sequence and controlled transition workflow',
  'hospital-customer-network.png':'Hospital and healthcare customer network across served units',
  'data-points-xu.png':'Data points and Xu performance intelligence visualization',
  'executive-action.png':'Executive action planning from evidence to accountable decisions',
};
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const dataUri=f=>`data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
function loadAssets(){
  const sumsPath=path.join(ASSET_DIR,'SHA256SUMS.txt');
  if(!fs.existsSync(sumsPath))throw Error(`Missing V5C checksum file: ${sumsPath}`);
  const expected=new Map(fs.readFileSync(sumsPath,'utf8').trim().split(/\r?\n/).map(line=>{const m=line.match(/^([a-f0-9]{64})\s+.*\/([^/]+)$/);if(!m)throw Error(`Invalid V5C checksum line: ${line}`);return[m[2],m[1]]}));
  return Object.fromEntries(ASSET_FILES.map(name=>{const file=path.join(ASSET_DIR,name);if(!fs.existsSync(file))throw Error(`Missing approved V5C asset: ${file}`);const actual=sha(file);if(expected.get(name)!==actual)throw Error(`V5C asset hash mismatch: ${name}`);return[name,{name,path:file,sha256:actual,uri:dataUri(file),alt:ASSET_ALT[name]}]}));
}
// 18 strategically selected slides. Detail QLNB pages 28–32 remain pure data tables.
const VISUAL_MAP={
  1:['cover-pharma-intelligence.png','cover','center'],
  2:['data-points-xu.png','side','center'],
  3:['executive-action.png','side','center'],
  6:['regional-healthcare-network.png','side','left'],
  7:['regional-healthcare-network.png','side','right'],
  8:['regional-healthcare-network.png','side','center'],
  11:['hospital-customer-network.png','side','center'],
  14:['pharma-sales-team.png','side narrow','center'],
  17:['pharma-sales-team.png','side narrow','right'],
  20:['hospital-customer-network.png','side narrow','left'],
  21:['product-portfolio.png','side narrow','center'],
  23:['product-portfolio.png','side','right'],
  24:['qlnb-sequence.png','side','center'],
  25:['qlnb-sequence.png','side narrow','left'],
  33:['data-points-xu.png','side','right'],
  35:['executive-action.png','side','left'],
  37:['executive-action.png','side','right'],
  38:['cover-pharma-intelligence.png','cover closing','right'],
};
function visualFigure(slideNo,spec,assets){const [name,treatment,position]=spec,a=assets[name];return `<figure class="v5cVisual ${treatment}" data-v5c-asset="${name}" data-v5c-sha256="${a.sha256}"><img src="${a.uri}" alt="${a.alt}" width="1672" height="941" style="object-position:${position}"><span aria-hidden="true"></span></figure>`}
function render(d){
  const assets=loadAssets();
  let doc=v5.render(d);
  doc=doc.replace(/<title>CEO Deck V5 Deep/g,'<title>CEO Deck V5C Images')
    .replace(/data-schema="5"/g,'data-schema="5.1"')
    .replace(/DRAFT V5 DEEP/g,'DRAFT V5C IMAGES')
    .replace(/V5 Deep/g,'V5C Images')
    .replace('<body data-schema="5.1"','<body data-schema="5.1" data-v5c-image-system="approved-local-assets"');
  for(const [slideNo,spec] of Object.entries(VISUAL_MAP)){
    const marker=`<section class="slide `,dataSlide=`data-slide="${slideNo}"`;
    const start=doc.indexOf(dataSlide);if(start<0)throw Error(`Missing slide ${slideNo} for V5C visual`);
    const sectionStart=doc.lastIndexOf(marker,start);if(sectionStart<0)throw Error(`Missing section for slide ${slideNo}`);
    const classEnd=doc.indexOf('"',sectionStart+16); // end of class value
    doc=doc.slice(0,classEnd)+` v5c-image-slide v5c-${String(slideNo).padStart(2,'0')}`+doc.slice(classEnd);
    const sectionEnd=doc.indexOf('</section>',start);if(sectionEnd<0)throw Error(`Missing section end ${slideNo}`);
    doc=doc.slice(0,sectionEnd)+visualFigure(Number(slideNo),spec,assets)+doc.slice(sectionEnd);
  }
  const css=`
/* V5C approved Premium Pharmaceutical image system */
.v5cVisual{position:absolute;z-index:2;margin:0;overflow:hidden;border-radius:.85vw;border:1px solid rgba(164,209,229,.85);background:#dcecf3;box-shadow:0 .9vh 2.2vh rgba(0,54,97,.16);pointer-events:none}.v5cVisual img{display:block;width:100%;height:100%;object-fit:cover;object-position:center}.v5cVisual>span{position:absolute;inset:0;background:linear-gradient(145deg,rgba(0,54,97,.04),rgba(0,138,134,.05));box-shadow:inset 0 0 0 1px rgba(255,255,255,.2)}
.slide.v5c-image-slide:not(.cover) .v5cVisual.side{right:3.7vw;top:16.2vh;width:20vw;height:24vh}.slide.v5c-image-slide:not(.cover) .v5cVisual.side.narrow{width:15vw;height:21vh}.slide.v5c-image-slide:not(.cover) main{padding-right:25vw}.slide.v5c-image-slide:not(.cover):has(.v5cVisual.narrow) main{padding-right:19vw}.slide.v5c-image-slide:not(.cover) .v5cVisual:after{content:'PREMIUM PHARMA';position:absolute;left:.7vw;bottom:.7vh;padding:.35vh .5vw;border-radius:.28vw;background:rgba(0,54,97,.82);color:#fff;font-size:.55vw;font-weight:900;letter-spacing:.1em}
.slide.v5c-06 .v5cVisual,.slide.v5c-07 .v5cVisual,.slide.v5c-08 .v5cVisual,.slide.v5c-11 .v5cVisual,.slide.v5c-14 .v5cVisual,.slide.v5c-17 .v5cVisual,.slide.v5c-20 .v5cVisual,.slide.v5c-21 .v5cVisual,.slide.v5c-24 .v5cVisual,.slide.v5c-25 .v5cVisual,.slide.v5c-33 .v5cVisual{top:auto;bottom:6.2vh}
.slide.v5c-06 main,.slide.v5c-07 main,.slide.v5c-08 main,.slide.v5c-11 main{padding-right:22vw}.slide.v5c-06 .v5cVisual,.slide.v5c-07 .v5cVisual,.slide.v5c-08 .v5cVisual,.slide.v5c-11 .v5cVisual{width:18vw}.slide.v5c-06 .shareCol,.slide.v5c-07 .shareCol{width:18%!important;white-space:nowrap;font-size:.62vw;letter-spacing:-.015em}.slide.v5c-06 table,.slide.v5c-07 table{table-layout:fixed}.slide.v5c-03 .cards,.slide.v5c-23 .cards{grid-template-columns:1fr 1fr}.slide.v5c-03 .cards article:last-child,.slide.v5c-23 .cards article:last-child{grid-column:1/-1;padding-top:1.1vh;padding-bottom:1.1vh}.slide.v5c-14 .tiers{gap:.5vw}.slide.v5c-14 .panel{padding-left:.55vw;padding-right:.55vw}.slide.v5c-14 table{font-size:.59vw;letter-spacing:-.01em}.slide.v5c-14 th,.slide.v5c-14 td{padding-left:.28vw;padding-right:.28vw}.slide.v5c-14 .shareCol{width:15%!important;font-size:.5vw}.slide.v5c-17 table,.slide.v5c-20 table,.slide.v5c-21 table,.slide.v5c-25 table{font-size:.73vw}.slide.v5c-24 .grid2{grid-template-columns:1.1fr .9fr}.slide.v5c-35 .riskGrid{grid-template-columns:1fr}.slide.v5c-35 .riskGrid article{padding-top:.65vh;padding-bottom:.65vh}.slide.v5c-37 .conclusion{grid-template-columns:1fr}.slide.v5c-37 .conclusion article:last-child{grid-column:auto}.slide.v5c-37 .conclusion article{padding-top:.55vh;padding-bottom:.55vh}.slide.v5c-37 .conclusion p{font-size:.86vw}
.cover .v5cVisual.cover{inset:0 0 0 auto;width:48vw;height:100%;border:0;border-radius:0;box-shadow:none;z-index:0}.cover .v5cVisual.cover img{object-position:center}.cover .v5cVisual.cover>span{background:linear-gradient(90deg,#003661 0%,rgba(0,54,97,.90) 16%,rgba(0,54,97,.28) 72%,rgba(0,54,97,.08) 100%)}.cover.v5c-01 .coverBody{padding-right:48vw}.cover.v5c-01 .coverStats{right:48vw}.cover.v5c-38 .v5cVisual.cover{left:0;right:auto;width:48vw}.cover.v5c-38 .v5cVisual.cover>span{background:linear-gradient(270deg,#003661 0%,rgba(0,54,97,.88) 18%,rgba(0,54,97,.20) 78%)}.cover.v5c-38 .endBody{padding-left:47vw}.cover.v5c-38 .endBody .logoPlate{align-self:flex-start}
`;
  doc=doc.replace('</style>',`${css}</style>`);
  return doc;
}
module.exports={render,loadAssets,VISUAL_MAP,ASSET_FILES,ASSET_DIR,assertOfficialLogo:v5.assertOfficialLogo,OFFICIAL_LOGO_PATH:v5.OFFICIAL_LOGO_PATH,OFFICIAL_LOGO_REL:v5.OFFICIAL_LOGO_REL,OFFICIAL_LOGO_SHA256:v5.OFFICIAL_LOGO_SHA256};
