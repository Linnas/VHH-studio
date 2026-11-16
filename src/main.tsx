import React from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@astryxdesign/core/theme';
import { looplineTheme } from './theme';
import { App } from './App';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <Theme theme={looplineTheme} mode="dark">
    <App />
  </Theme>,
);
