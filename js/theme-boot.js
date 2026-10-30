(() => {
  let choice = 'system';
  try {
    choice = JSON.parse(localStorage.getItem('typing-game/prefs/v1') ?? '{}').theme ?? 'system';
  } catch {}
  const light =
    choice === 'light' ||
    (choice === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
})();
