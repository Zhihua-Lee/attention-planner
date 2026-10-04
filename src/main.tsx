import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { store } from './store/store';
import { App } from './ui/App';
import './styles/app.css';

void store.init();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
if (import.meta.env.PROD) registerSW({ immediate: true });
