#!/usr/bin/env python3
"""
app.py - Aplicación de escritorio para convertir Markdown (.md) a PDF.

Interfaz gráfica sobre el núcleo de `md_to_pdf.py`: seleccionas archivos o una
carpeta, eliges dónde guardar y conviertes. Toda la conversión corre en un hilo
aparte para que la ventana no se congele.

Ejecutar:
    python app.py

O bien, en Windows, con doble clic en "Markdown a PDF.vbs" (sin consola).
"""

import os
import queue
import subprocess
import sys
import threading
import traceback
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import md_to_pdf


APP_NOMBRE = "Markdown → PDF"

# La lista vive en el núcleo para que la búsqueda por carpeta y la selección de
# archivos sueltos no puedan discrepar.
EXTENSIONES_MD = md_to_pdf.EXTENSIONES_MD

# Tamaño de la ventana pensado para 96 ppp; se reescala según la pantalla.
ANCHO_BASE, ALTO_BASE = 820, 640


def activar_conciencia_dpi():
    """
    En Windows, evita que el sistema estire la ventana como un mapa de bits
    (que se ve borroso) y deja que la dibujemos nosotros a la resolución real.
    """
    if sys.platform != "win32":
        return
    import ctypes
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)   # PROCESS_SYSTEM_DPI_AWARE
    except (AttributeError, OSError):
        try:
            ctypes.windll.user32.SetProcessDPIAware()    # respaldo para Windows 7/8
        except (AttributeError, OSError):
            pass


class AplicacionMdToPdf(tk.Tk):
    def __init__(self):
        super().__init__()

        # Factor de escala de la pantalla (1.0 a 96 ppp, 1.5 al 150 %, etc.)
        self.escala = self.winfo_fpixels("1i") / 96.0
        self.tk.call("tk", "scaling", self.winfo_fpixels("1i") / 72.0)

        ancho = int(ANCHO_BASE * self.escala)
        alto = int(ALTO_BASE * self.escala)

        self.title(APP_NOMBRE)
        self.geometry(f"{ancho}x{alto}")
        self.minsize(int(700 * self.escala), int(560 * self.escala))

        icono = Path(__file__).parent / "recursos" / "md-to-pdf.ico"
        if icono.exists():
            try:
                self.iconbitmap(str(icono))
            except tk.TclError:
                pass

        # Estado
        self.archivos = []              # lista de Path a los .md seleccionados
        self.convirtiendo = False
        self.cola_eventos = queue.Queue()   # comunicación hilo -> interfaz
        self.cancelar = threading.Event()   # el hilo la consulta entre archivos
        self._tarea_cola = None             # id del after() para poder cancelarlo
        self.protocol("WM_DELETE_WINDOW", self.al_cerrar)

        # Variables de la interfaz
        self.var_destino_junto = tk.BooleanVar(value=True)
        self.var_carpeta_salida = tk.StringVar(value="")
        self.var_recursivo = tk.BooleanVar(value=True)
        self.var_abrir_al_terminar = tk.BooleanVar(value=True)
        self.var_css = tk.StringVar(value="")
        self.var_estado = tk.StringVar(value="Sin archivos seleccionados.")

        self._construir_interfaz()
        self._tarea_cola = self.after(100, self._procesar_cola)

    def al_cerrar(self):
        """Detiene el sondeo de la cola antes de destruir la ventana."""
        self.cancelar.set()
        if self._tarea_cola is not None:
            try:
                self.after_cancel(self._tarea_cola)
            except tk.TclError:
                pass
            self._tarea_cola = None
        self.destroy()

    # ------------------------------------------------------------------ #
    # Construcción de la interfaz
    # ------------------------------------------------------------------ #

    def _construir_interfaz(self):
        contenedor = ttk.Frame(self, padding=14)
        contenedor.pack(fill="both", expand=True)

        ttk.Label(
            contenedor,
            text=APP_NOMBRE,
            font=("Segoe UI", 16, "bold"),
        ).pack(anchor="w")

        ttk.Label(
            contenedor,
            text="Convierte archivos Markdown a PDF con diagramas Mermaid y resaltado de sintaxis.",
            foreground="#555",
        ).pack(anchor="w", pady=(0, 12))

        self._construir_seccion_archivos(contenedor)
        self._construir_seccion_salida(contenedor)
        self._construir_seccion_opciones(contenedor)
        self._construir_seccion_accion(contenedor)
        self._construir_seccion_registro(contenedor)

    def _construir_seccion_archivos(self, padre):
        marco = ttk.LabelFrame(padre, text=" 1. Archivos a convertir ", padding=10)
        marco.pack(fill="both", expand=True)

        fila = ttk.Frame(marco)
        fila.pack(fill="both", expand=True)

        self.lista = tk.Listbox(fila, height=8, activestyle="none")
        self.lista.pack(side="left", fill="both", expand=True)

        barra = ttk.Scrollbar(fila, orient="vertical", command=self.lista.yview)
        barra.pack(side="left", fill="y")
        self.lista.configure(yscrollcommand=barra.set)

        botones = ttk.Frame(fila)
        botones.pack(side="left", fill="y", padx=(10, 0))

        ttk.Button(botones, text="Agregar archivos…", width=18,
                   command=self.agregar_archivos).pack(fill="x", pady=2)
        ttk.Button(botones, text="Agregar carpeta…", width=18,
                   command=self.agregar_carpeta).pack(fill="x", pady=2)
        ttk.Button(botones, text="Quitar selección", width=18,
                   command=self.quitar_seleccion).pack(fill="x", pady=2)
        ttk.Button(botones, text="Limpiar todo", width=18,
                   command=self.limpiar).pack(fill="x", pady=2)

        ttk.Label(marco, textvariable=self.var_estado,
                  foreground="#555").pack(anchor="w", pady=(8, 0))

    def _construir_seccion_salida(self, padre):
        marco = ttk.LabelFrame(padre, text=" 2. Dónde guardar los PDF ", padding=10)
        marco.pack(fill="x", pady=(12, 0))

        ttk.Radiobutton(
            marco,
            text="Junto al archivo original",
            variable=self.var_destino_junto,
            value=True,
            command=self._alternar_destino,
        ).pack(anchor="w")

        fila = ttk.Frame(marco)
        fila.pack(fill="x", pady=(4, 0))

        ttk.Radiobutton(
            fila,
            text="En esta carpeta:",
            variable=self.var_destino_junto,
            value=False,
            command=self._alternar_destino,
        ).pack(side="left")

        self.entrada_salida = ttk.Entry(fila, textvariable=self.var_carpeta_salida)
        self.entrada_salida.pack(side="left", fill="x", expand=True, padx=6)

        self.boton_salida = ttk.Button(fila, text="Examinar…", command=self.elegir_carpeta_salida)
        self.boton_salida.pack(side="left")

        self._alternar_destino()

    def _construir_seccion_opciones(self, padre):
        marco = ttk.LabelFrame(padre, text=" 3. Opciones ", padding=10)
        marco.pack(fill="x", pady=(12, 0))

        ttk.Checkbutton(
            marco,
            text="Al agregar una carpeta, incluir también sus subcarpetas",
            variable=self.var_recursivo,
        ).pack(anchor="w")

        ttk.Checkbutton(
            marco,
            text="Abrir la carpeta de salida al terminar",
            variable=self.var_abrir_al_terminar,
        ).pack(anchor="w")

        fila = ttk.Frame(marco)
        fila.pack(fill="x", pady=(6, 0))

        ttk.Label(fila, text="CSS personalizado (opcional):").pack(side="left")
        ttk.Entry(fila, textvariable=self.var_css).pack(
            side="left", fill="x", expand=True, padx=6)
        ttk.Button(fila, text="Examinar…", command=self.elegir_css).pack(side="left")

    def _construir_seccion_accion(self, padre):
        marco = ttk.Frame(padre)
        marco.pack(fill="x", pady=(14, 0))

        self.boton_convertir = ttk.Button(
            marco, text="Convertir a PDF", command=self.iniciar_conversion)
        self.boton_convertir.pack(side="left")

        self.boton_cancelar = ttk.Button(
            marco, text="Cancelar", command=self.solicitar_cancelar, state="disabled")
        self.boton_cancelar.pack(side="left", padx=(8, 0))

        self.barra_progreso = ttk.Progressbar(marco, mode="determinate")
        self.barra_progreso.pack(side="left", fill="x", expand=True, padx=12)

    def solicitar_cancelar(self):
        """El lote se detiene al terminar el archivo que esté en curso."""
        self.cancelar.set()
        self.boton_cancelar.configure(state="disabled")
        self.escribir("Cancelando… (se termina el archivo en curso)")

    def _construir_seccion_registro(self, padre):
        marco = ttk.LabelFrame(padre, text=" Registro ", padding=8)
        marco.pack(fill="both", expand=True, pady=(12, 0))

        self.registro = tk.Text(marco, height=8, wrap="word", state="disabled",
                                background="#1e1e1e", foreground="#d4d4d4",
                                font=("Consolas", 9), relief="flat")
        self.registro.pack(side="left", fill="both", expand=True)

        barra = ttk.Scrollbar(marco, orient="vertical", command=self.registro.yview)
        barra.pack(side="left", fill="y")
        self.registro.configure(yscrollcommand=barra.set)

    # ------------------------------------------------------------------ #
    # Acciones de la interfaz
    # ------------------------------------------------------------------ #

    def _alternar_destino(self):
        estado = "disabled" if self.var_destino_junto.get() else "normal"
        self.entrada_salida.configure(state=estado)
        self.boton_salida.configure(state=estado)

    def agregar_archivos(self):
        rutas = filedialog.askopenfilenames(
            title="Selecciona uno o varios archivos Markdown",
            filetypes=[("Archivos Markdown", "*.md *.markdown *.mdown *.mkd"),
                       ("Todos los archivos", "*.*")],
        )
        self._agregar(Path(r) for r in rutas)

    def agregar_carpeta(self):
        carpeta = filedialog.askdirectory(title="Selecciona una carpeta con archivos .md")
        if not carpeta:
            return

        encontrados = md_to_pdf.buscar_markdown(Path(carpeta), self.var_recursivo.get())
        if not encontrados:
            messagebox.showinfo(
                APP_NOMBRE,
                f"No se encontraron archivos .md en:\n{carpeta}",
            )
            return
        self._agregar(encontrados)

    def _agregar(self, rutas):
        nuevos = 0
        for ruta in rutas:
            ruta = Path(ruta)
            if ruta.suffix.lower() not in EXTENSIONES_MD:
                continue
            if ruta in self.archivos:
                continue
            self.archivos.append(ruta)
            self.lista.insert("end", str(ruta))
            nuevos += 1

        if nuevos:
            self.escribir(f"Agregado(s) {nuevos} archivo(s).")
        self._actualizar_estado()

    def quitar_seleccion(self):
        for indice in sorted(self.lista.curselection(), reverse=True):
            self.lista.delete(indice)
            del self.archivos[indice]
        self._actualizar_estado()

    def limpiar(self):
        self.lista.delete(0, "end")
        self.archivos.clear()
        self._actualizar_estado()

    def elegir_carpeta_salida(self):
        carpeta = filedialog.askdirectory(title="Carpeta donde guardar los PDF")
        if carpeta:
            self.var_carpeta_salida.set(carpeta)

    def elegir_css(self):
        ruta = filedialog.askopenfilename(
            title="Selecciona un archivo CSS",
            filetypes=[("Hojas de estilo", "*.css"), ("Todos los archivos", "*.*")],
        )
        if ruta:
            self.var_css.set(ruta)

    def _actualizar_estado(self):
        total = len(self.archivos)
        if total == 0:
            self.var_estado.set("Sin archivos seleccionados.")
        elif total == 1:
            self.var_estado.set("1 archivo listo para convertir.")
        else:
            self.var_estado.set(f"{total} archivos listos para convertir.")

    def escribir(self, texto):
        self.registro.configure(state="normal")
        self.registro.insert("end", texto + "\n")
        self.registro.see("end")
        self.registro.configure(state="disabled")

    # ------------------------------------------------------------------ #
    # Conversión
    # ------------------------------------------------------------------ #

    def iniciar_conversion(self):
        if self.convirtiendo:
            return

        if not self.archivos:
            messagebox.showwarning(APP_NOMBRE, "Primero agrega al menos un archivo .md.")
            return

        # Resolver la carpeta de salida
        if self.var_destino_junto.get():
            carpeta_salida = None
        else:
            valor = self.var_carpeta_salida.get().strip()
            if not valor:
                messagebox.showwarning(APP_NOMBRE, "Elige la carpeta donde guardar los PDF.")
                return
            carpeta_salida = Path(valor)

        # Resolver el CSS
        css_str = None
        ruta_css = self.var_css.get().strip()
        if ruta_css:
            try:
                css_str = Path(ruta_css).read_text(encoding="utf-8")
            except OSError as e:
                messagebox.showerror(APP_NOMBRE, f"No se pudo leer el CSS:\n{e}")
                return

        # Armar los pares (origen, destino). Al volcar todo a una sola carpeta
        # hay que evitar que dos archivos con el mismo nombre se pisen.
        if carpeta_salida:
            pares = md_to_pdf.destinos_sin_colision(self.archivos, carpeta_salida)
            renombrados = sum(
                1 for md, destino in pares if destino.stem != md.stem)
            if renombrados:
                self.escribir(
                    f"Aviso: {renombrados} archivo(s) con nombre repetido se "
                    f"guardarán con el nombre de su carpeta para no pisarse.")
        else:
            pares = [(md, md.with_suffix(".pdf")) for md in self.archivos]

        self.cancelar.clear()
        self.convirtiendo = True
        self.boton_convertir.configure(state="disabled", text="Convirtiendo…")
        self.boton_cancelar.configure(state="normal")
        self.barra_progreso.configure(value=0, maximum=len(pares))
        self.escribir(f"\n=== Convirtiendo {len(pares)} archivo(s) ===")

        hilo = threading.Thread(
            target=self._trabajo_conversion,
            args=(pares, css_str),
            daemon=True,
        )
        hilo.start()

    def _trabajo_conversion(self, pares, css_str):
        """Corre en un hilo aparte. Reporta a la interfaz vía self.cola_eventos."""
        def progreso(indice, total, resultado):
            self.cola_eventos.put(("avance", (indice, total, resultado)))

        try:
            resultados = md_to_pdf.convertir_lote(
                pares, css_str,
                progreso=progreso,
                cancelado=self.cancelar.is_set,
            )
            destinos = [destino for _, destino in pares]
            self.cola_eventos.put(("fin", (resultados, destinos)))

        except md_to_pdf.ErrorAssets as e:
            self.cola_eventos.put(("error", str(e)))

        # BaseException y no Exception: asegurar_assets() solía llamar a
        # sys.exit(), que lanza SystemExit y NO hereda de Exception. Se escapaba
        # de aquí, mataba el hilo en silencio y la ventana se quedaba en
        # "Convirtiendo…" para siempre.
        except BaseException:
            self.cola_eventos.put(("error", traceback.format_exc()))

    def _procesar_cola(self):
        """Vacía la cola de eventos del hilo de conversión y actualiza la interfaz."""
        try:
            while True:
                tipo, datos = self.cola_eventos.get_nowait()

                if tipo == "avance":
                    indice, total, resultado = datos
                    estado = (f"OK  ->  {resultado.destino.name}"
                              if resultado.ok else "FALLÓ")
                    self.escribir(
                        f"[{indice}/{total}] {resultado.origen.name} ... {estado}")
                    if resultado.error:
                        self.escribir(f"        error: {resultado.error}")
                    for aviso in resultado.avisos:
                        self.escribir(f"        aviso: {aviso}")
                    self.barra_progreso.configure(value=indice)

                elif tipo == "fin":
                    resultados, destinos = datos
                    self._terminar(resultados, destinos)

                elif tipo == "error":
                    self.escribir(datos)
                    self._restaurar_boton()
                    messagebox.showerror(
                        APP_NOMBRE,
                        "La conversión falló y se detuvo. Revisa el registro.\n\n"
                        "Si el error menciona el navegador, ejecuta una vez:\n"
                        "    playwright install chromium",
                    )
        except queue.Empty:
            pass

        self._tarea_cola = self.after(100, self._procesar_cola)

    def _terminar(self, resultados, destinos):
        exitos = sum(1 for r in resultados if r.ok)
        fallos = len(resultados) - exitos
        con_avisos = sum(1 for r in resultados if r.avisos)
        pendientes = len(destinos) - len(resultados)

        self.escribir(f"=== Listo: {exitos} exitoso(s), {fallos} fallido(s) ===")
        if pendientes:
            self.escribir(f"Cancelado: quedaron {pendientes} archivo(s) sin convertir.")
        self._restaurar_boton()

        if exitos and self.var_abrir_al_terminar.get():
            self.abrir_carpeta(destinos[0].parent)

        resumen = f"Conversión terminada.\n\nExitosos: {exitos}\nFallidos: {fallos}"
        if con_avisos:
            resumen += f"\nCon avisos: {con_avisos}  (revisa el registro)"
        if pendientes:
            resumen += f"\nSin convertir por cancelación: {pendientes}"
        messagebox.showinfo(APP_NOMBRE, resumen)

    def _restaurar_boton(self):
        self.convirtiendo = False
        self.cancelar.clear()
        self.boton_convertir.configure(state="normal", text="Convertir a PDF")
        self.boton_cancelar.configure(state="disabled")

    @staticmethod
    def abrir_carpeta(carpeta: Path):
        try:
            if sys.platform == "win32":
                os.startfile(str(carpeta))          # noqa: S606
            elif sys.platform == "darwin":
                subprocess.run(["open", str(carpeta)], check=False)
            else:
                subprocess.run(["xdg-open", str(carpeta)], check=False)
        except OSError:
            pass


def main():
    activar_conciencia_dpi()
    app = AplicacionMdToPdf()
    app.mainloop()


if __name__ == "__main__":
    main()
