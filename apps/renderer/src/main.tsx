import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { installTauriBridge } from './services/tauri-api';
import './index.css';

installTauriBridge();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
