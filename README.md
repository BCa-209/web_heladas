# ❄️ Sistema Visualizador 3D de Predicción de Heladas • Altiplano

Plataforma geoespacial interactiva en 3D para la visualización, monitoreo y análisis de riesgo de heladas meteorológicas en el **Altiplano Peruano (Puno / Juliaca)**, desarrollada con **Three.js (WebGL)** y mapas sincronizados en **OpenStreetMap**.

---

## 🏔️ Características Principales

- **Topografía 3D de Alta Precisión:**
  - Malla tridimensional generada a partir del Modelo Digital de Elevación (DEM SRTM de 1 segundo de arco) de Puno/Juliaca (3,812 m a 5,400 m de altitud).
  - Tres modos de renderizado: **Sombreado fotorrealista**, **Malla Wireframe** (fiel al renderizador OpenGL original) y **Curvas de Nivel (Relieve)**.
  - Factor de escala vertical ajustable (exageración Z de $0.5\times$ a $4.0\times$) y rotación orbital libre.
  - Sondaje de coordenadas en tiempo real (Raycaster): lectura directa de Latitud, Longitud, Altitud (m.s.n.m.) y Probabilidad de Helada en cada punto de la superficie.

- **4 Modelos Predictivos Evaluados:**
  1. `01_XGBoost`: Ensamble de Potenciación de Gradiente (*Balance General*).
  2. `02_Random_Forest`: Ensamble de Árboles Decisionales (*Robusto a Ruido*).
  3. `03_LSTM_Network`: Modelo Predictivo de Secuencias Temporales (*Inercia Temporal*).
  4. `04_SVM`: Máquina de Vectores de Soporte (*Margen Máximo*).
  - Selector en tiempo real con recálculo dinámico del mapa térmico y métricas de desempeño meteorológico (Accuracy, ROC-AUC, CSI - Critical Success Index y Brier Score).

- **Línea de Tiempo y Reproducción Temporal:**
  - Simulación temporal continua de ciclos de helada con velocidades $1\times$, $2\times$ y $5\times$.
  - Atajos de teclado: <kbd>Espacio</kbd> (Play/Pause), <kbd>→</kbd> / <kbd>D</kbd> (Siguiente hora), <kbd>←</kbd> / <kbd>A</kbd> (Hora anterior).
  - Botón de salto automático al instante de **Pico Crítico** y buscador de fecha por texto.

- **Cartografía 2D Integrada:**
  - Mini-mapa regional sincronizado sobre **OpenStreetMap** que delimita la huella del DEM 3D activo y la dispersión geográfica del riesgo.

- **Captura de Pantalla:**
  - Exportación con un solo clic de capturas en alta resolución PNG (`.png`).

---

## 🚀 Ejecución Local

Para visualizar la aplicación en tu navegador:

1. **Opción 1 (Windows - Lanzador rápido):**
   Haz doble clic sobre el archivo `iniciar_servidor.bat`.

2. **Opción 2 (Consola con Python):**
   ```bash
   # Dentro del directorio del proyecto
   python -m http.server 8000
   ```
   Luego abre tu navegador en: [http://localhost:8000](http://localhost:8000)

---

## 📁 Estructura del Repositorio

```
web_heladas/
├── index.html               # Estructura del visor y controles
├── style.css                # Interfaz de usuario responsiva
├── app.js                   # Lógica 3D WebGL, Leaflet y telemetría
├── iniciar_servidor.bat     # Lanzador local para Windows
├── prepare_data.py          # Script de procesamiento de datos topográficos y modelos
│
├── data/
│   ├── terrain.json         # Matriz de elevación DEM 128x128
│   └── models_data.json     # Series temporales e interpolaciones para los 4 modelos
│
└── libs/
    ├── three.min.js         # Librería Three.js (r128)
    ├── OrbitControls.js     # Controles orbitales 3D
    ├── leaflet.js           # Motor de mapas 2D
    └── leaflet.css          # Estilos de mapas
```
