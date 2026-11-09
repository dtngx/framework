/* KEKS Werkzeugkasten – Hell/Dunkel vor dem ersten Zeichnen setzen.
   Synchron im <head> einbinden (nach design.css), damit nichts aufblitzt.
   Die Wahl kommt vom Schalter im Dashboard (localStorage), sonst vom System. */
(function () {
  var theme;
  try { theme = localStorage.getItem('toolbox-theme'); } catch (_) { /* privater Modus */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
