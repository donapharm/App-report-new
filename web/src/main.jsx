import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { PrivacyProvider } from './privacy.jsx';
import './styles.css';

// PrivacyProvider bọc NGOÀI App: một công tắc ẩn/hiện số cho toàn bộ màn hình.
createRoot(document.getElementById('root')).render(
  <PrivacyProvider><App /></PrivacyProvider>,
);
