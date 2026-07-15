'use strict';
const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');
const { screenshotsFromHtml } = require('./deckPptx');

async function buildPptxV2({ htmlPath, outputPath, title }) {
  const output = path.resolve(outputPath || htmlPath.replace(/\.html$/i, '.pptx'));
  const rendered = await screenshotsFromHtml(path.resolve(htmlPath), { width: 1920, height: 1080 });
  try {
    if (rendered.files.length !== 32) throw new Error(`PPTX V2 cần 32 slide, hiện có ${rendered.files.length}`);
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = 'GROUP DONAPHARM — App Report New';
    pptx.company = 'CÔNG TY CỔ PHẦN DONAPHARM';
    pptx.subject = 'Báo cáo doanh số chuyên sâu CEO — DRAFT V2';
    pptx.title = title || 'GROUP DONAPHARM — Báo cáo doanh số DRAFT V2';
    pptx.lang = 'vi-VN';
    pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos', lang: 'vi-VN' };
    for (const file of rendered.files) {
      const slide = pptx.addSlide(); slide.background = { color: '071F47' };
      slide.addImage({ path: file, x: 0, y: 0, w: 13.333333, h: 7.5 });
    }
    await pptx.writeFile({ fileName: output });
    return { outputPath: output, slideCount: rendered.files.length, imageWidth: 1920, imageHeight: 1080, bytes: fs.statSync(output).size };
  } finally {
    try { fs.rmSync(rendered.imageDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
module.exports = { buildPptxV2 };
