/*
  Navegación del deck de AFGI: flechas, teclado y contador que sigue al
  scroll. Vivía inline en index.html; se mudó a este archivo el 2026-09-05
  para que el deck corra bajo la CSP general del sitio (script-src estricto,
  sin unsafe-inline) y dejar de necesitar una regla propia en vercel.json.

  Se carga con ruta absoluta (/afgi/deck.js): producción sirve /afgi sin
  barra final, y desde ahí una ruta relativa resolvería a /deck.js.
*/
(function () {
  var deck = document.getElementById('deck');
  var slides = Array.prototype.slice.call(deck.querySelectorAll('.slide'));
  var cur = document.getElementById('cur');
  var idx = 0;

  document.getElementById('tot').textContent = slides.length;

  function go(n) {
    idx = Math.max(0, Math.min(slides.length - 1, n));
    slides[idx].scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center'
    });
  }

  document.getElementById('next').addEventListener('click', function () { go(idx + 1); });
  document.getElementById('prev').addEventListener('click', function () { go(idx - 1); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(idx + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(slides.length - 1); }
  });

  // el contador sigue al scroll manual
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          idx = slides.indexOf(en.target);
          cur.textContent = idx + 1;
        }
      });
    }, { root: deck, threshold: 0.55 });
    slides.forEach(function (s) { io.observe(s); });
  }
})();
