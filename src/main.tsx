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
if (import.meta.env.PROD)
  registerSW({
    immediate: true,
    // An app left open (an iPhone home-screen app is rarely started afresh) looks for a new version each time it comes
    // back to the screen; a new version then takes over at once.
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    },
  });
