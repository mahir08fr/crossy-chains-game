import { mountGameShell } from './game-shell';
const mode = location.pathname === '/display.html' ? 'phones' : location.pathname === '/local.html' ? 'keyboard' : 'online';
const shell = mountGameShell(mode);
try {
  if (mode === 'phones') await import('./display-main');
  else if (mode === 'keyboard') await import('./local-main');
  else await import('./multiplayer-main');
} catch (error) {
  document.getElementById('menu-feedback')!.textContent = `Unable to initialize the game. Use a browser with WebGL2, then reload. ${error instanceof Error ? error.message : ''}`;
}
if (import.meta.hot) import.meta.hot.dispose(() => shell.dispose());
