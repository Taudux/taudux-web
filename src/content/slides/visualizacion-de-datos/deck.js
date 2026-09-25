/*
  Controlador del deck "Visualización de datos": qué diapositiva está activa
  y cuándo renderizar sus gráficas de Plotly. Vivía como un <script> inline
  al final del deck original; se extrajo a este archivo por la misma razón
  que graficas.js: el CSP del sitio no admite 'unsafe-inline' en script-src.

  Expone una API mínima para que el visor de Slides (slides.js) pueda
  controlarlo desde afuera del <iframe>:

    window.slidesDeck = {
      total: <número de diapositivas>,
      indice(): <índice de la diapositiva activa, 0-based>,
      ir(n): <mueve a la diapositiva n, acotada al rango válido>,
    };

  Y dispara un evento en cada cambio, para que el visor no tenga que
  encuestar el índice a mano:

    document.dispatchEvent(new CustomEvent("slides:cambio", {
      detail: { indice, total },
    }));

  El resto es igual al deck original: qué diapositiva está "active", el
  render perezoso de cada ".plot[data-chart]" (una vez por diapositiva, con
  "data-rendered" como marca) y las flechas de teclado. Se agregan Home/End
  para saltar a la primera/última diapositiva, inofensivo y consistente con
  el resto del sitio (mismo repertorio que slides.logica.js).
*/

(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide'));
  var idx=0;
  window.slidesDeck = {
    total: slides.length,
    indice: function () { return idx; },
    ir: function (n) { show(n); },
  };
  var base={responsive:true,scrollZoom:false,displaylogo:false};
  function render(slide){
    slide.querySelectorAll('.plot').forEach(function(el){
      var id=el.getAttribute('data-chart');
      if(!id||!window.CHARTS[id]||!window.Plotly)return;
      if(el.getAttribute('data-rendered')){ Plotly.Plots.resize(el); return; }
      var spec=window.CHARTS[id];
      var cfg=Object.assign({},base);
      if(el.getAttribute('data-modebar')!=='1'){ cfg.displayModeBar=false; }
      var data=JSON.parse(JSON.stringify(spec.data));
      var layout=JSON.parse(JSON.stringify(spec.layout));
      var frames=spec.frames?JSON.parse(JSON.stringify(spec.frames)):null;
      Plotly.newPlot(el, data, layout, cfg).then(function(){
        if(frames&&frames.length){ Plotly.addFrames(el, frames); }
        el.setAttribute('data-rendered','1'); Plotly.Plots.resize(el);
      });
    });
  }
  function show(i){
    i=Math.max(0,Math.min(slides.length-1,i));
    slides[idx].classList.remove('active');
    idx=i; var s=slides[idx]; s.classList.add('active');
    requestAnimationFrame(function(){requestAnimationFrame(function(){render(s);});});
    document.dispatchEvent(new CustomEvent('slides:cambio', { detail: { indice: idx, total: slides.length } }));
  }
  function next(){show(idx+1);} function prev(){show(idx-1);}
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'){e.preventDefault();next();}
    else if(e.key==='ArrowLeft'){e.preventDefault();prev();}
    else if(e.key==='Home'){e.preventDefault();show(0);}
    else if(e.key==='End'){e.preventDefault();show(slides.length-1);}
  });
  window.addEventListener('resize',function(){ if(!window.Plotly)return; slides[idx].querySelectorAll('.plot[data-rendered]').forEach(function(el){Plotly.Plots.resize(el);}); });
  show(0);
})();

