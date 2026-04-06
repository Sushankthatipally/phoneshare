import React from 'react';
import ReactDOM from 'react-dom/client';

import '@dropbeam/shared-ui/tokens.css';

import App from './App.js';
import './index.css';
import './styles.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
