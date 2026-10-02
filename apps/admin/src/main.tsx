import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initI18n } from './app/i18n';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

await initI18n();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
