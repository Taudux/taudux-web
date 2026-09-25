/*
  Controlador del deck "Curso SQL": qué diapositiva está activa, el contador
  propio, el modal "Salida esperada" (se cierra con Esc) y la dirección #n
  dentro del marco. Vivía como un <script> en línea al final del deck
  original; se extrajo a este archivo porque la CSP del sitio no admite
  'unsafe-inline' en script-src.

  Sobre el original sólo se agregó el contrato que el visor de Slides
  (slides.js) espera, el mismo que visualizacion-de-datos/deck.js:

    window.slidesDeck = { total, indice(), ir(n) }
    document "slides:cambio" → detail: { indice, total }

  más Inicio/Fin, para que el teclado sea igual dentro y fuera del marco.
*/
const slides=[...document.querySelectorAll('.slide')];const N=slides.length;let cur=0;
const counter=document.getElementById('counter');
function show(i){cur=Math.max(0,Math.min(N-1,i));slides.forEach((s,k)=>s.classList.toggle('active',k===cur));
 counter.textContent=(cur+1)+' / '+N;history.replaceState(null,'','#'+(cur+1));
 document.dispatchEvent(new CustomEvent('slides:cambio',{detail:{indice:cur,total:N}}));}
function next(){show(cur+1)}function prev(){show(cur-1)}
const modal=document.getElementById('modal'),mbody=document.getElementById('mbody');
document.addEventListener('click',e=>{if(e.target.classList.contains('ampliar')){const t=e.target.parentElement.querySelector('.rtbl-scroll');mbody.innerHTML=t.innerHTML;modal.classList.add('show');e.preventDefault();}});
document.getElementById('mclose').onclick=()=>modal.classList.remove('show');
modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('show');});
document.addEventListener('keydown',e=>{
 if(modal.classList.contains('show')){if(e.key==='Escape')modal.classList.remove('show');return;}
 if(e.key==='ArrowRight'){next();e.preventDefault();}
 else if(e.key==='ArrowLeft'){prev();e.preventDefault();}
 else if(e.key==='Home'){show(0);e.preventDefault();}
 else if(e.key==='End'){show(N-1);e.preventDefault();}
});
window.slidesDeck={total:N,indice:()=>cur,ir:(n)=>show(n)};
const h=parseInt(location.hash.replace('#',''));show(Number.isInteger(h)&&h>=1?h-1:0);
