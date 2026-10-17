// Aplica o tema antes do React montar, pra não piscar branco no escuro.
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('discordia.settings') || '{}');
    var t = s.theme || 'system';
    var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
