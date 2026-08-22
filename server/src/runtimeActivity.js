'use strict';

// Ngữ cảnh tối thiểu cho cảnh báo nghẽn. Chỉ giữ mã nội bộ/tên tác vụ và số byte;
// tuyệt đối không giữ URL, query, payload, mã nhân viên hay thông tin phiên.
let requestSequence = 0;
const activeRequests = new Set();
const backgroundTasks = new Map();
let parentDecode = { active: false, bytes: 0, atMs: 0 };

function beginRequest() {
  requestSequence += 1;
  const id = `http-${process.pid}-${requestSequence}`;
  activeRequests.add(id);
  return { id, finish: () => activeRequests.delete(id) };
}

function beginBackground(name) {
  const key = String(name || 'unknown').slice(0, 64);
  backgroundTasks.set(key, (backgroundTasks.get(key) || 0) + 1);
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    const left = (backgroundTasks.get(key) || 1) - 1;
    if (left > 0) backgroundTasks.set(key, left);
    else backgroundTasks.delete(key);
  };
}

function beginParentDecode(totalBytes = 0) {
  parentDecode = { active: true, bytes: 0, totalBytes: Math.max(0, Number(totalBytes) || 0), atMs: Date.now() };
}

function parentDecoded(bytes) {
  parentDecode = { ...parentDecode, active: true, bytes: Math.max(0, Number(bytes) || 0), atMs: Date.now() };
}

function endParentDecode() {
  parentDecode = { ...parentDecode, active: false, atMs: Date.now() };
}

function snapshot() {
  return {
    requestIds: [...activeRequests].slice(0, 8),
    backgroundTasks: [...backgroundTasks.keys()].slice(0, 8),
    parentDecodeActive: parentDecode.active,
    parentDecodedBytes: parentDecode.bytes,
    parentDecodeTotalBytes: parentDecode.totalBytes || 0,
  };
}

function resetForTests() {
  activeRequests.clear();
  backgroundTasks.clear();
  parentDecode = { active: false, bytes: 0, atMs: 0 };
  requestSequence = 0;
}

module.exports = { beginRequest, beginBackground, beginParentDecode, parentDecoded, endParentDecode, snapshot, resetForTests };
