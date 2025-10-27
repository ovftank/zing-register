import '@/assets/css/index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from '@/app';

const container = document.getElementById('root');
if (!container) {
    throw new Error('Root element not found in index.html');
}

const root = createRoot(container);
root.render(React.createElement(BrowserRouter, null, React.createElement(App)));
