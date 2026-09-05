# taudux.com

Plataforma de cursos. Sitio estático (HTML/CSS/JS vanilla) desplegado en
**Vercel**, con **Supabase** como backend. Idioma del producto: español.

La app móvil vive en un repo aparte: `taudux-mobile`.

```bash
node --test "tests/*.test.js"
```

El glob **entre comillas** importa: `node --test tests/` falla en Git Bash. Y
hay que correrlo desde la raíz, porque varios tests leen rutas relativas.
**Nada corre en CI**: si algo se rompe, sólo lo detecta quien lo ejecute a mano.
