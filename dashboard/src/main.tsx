import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { OverviewPage } from './pages/OverviewPage.js';
import { RunsPage } from './pages/RunsPage.js';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('missing #root element');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/runs" element={<RunsPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
