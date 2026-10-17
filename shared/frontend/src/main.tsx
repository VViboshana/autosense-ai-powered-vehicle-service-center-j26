import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'admin-lte/dist/css/adminlte.min.css';
import 'bootstrap-icons/font/bootstrap-icons.min.css';
import './theme/autosense.css';
import './theme/screens.css';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
