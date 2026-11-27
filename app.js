/**
 * SISTEMA GEOESPACIAL 3D DE PREDICCIÓN DE HELADAS • ALTIPLANO PERUANO
 * Motor WebGL Three.js + Leaflet 2D + Control de Telemetría Temporal
 */

(function () {
  'use strict';

  // --- ESTADO GLOBAL DE LA APLICACIÓN ---
  const state = {
    terrain: null,
    models: null,
    activeModelId: 'xgboost',
    activeFrameIndex: 0,
    isPlaying: false,
    playInterval: null,
    playSpeed: 1000, // ms por frame (1x)
    renderMode: 'shaded', // 'shaded' | 'wireframe' | 'contour'
    exaggeration: 1.0,
    autoRotate: false,
    hoveredPoint: null
  };

  // --- REFERENCIAS DOM ---
  const canvas = document.getElementById('webglCanvas');
  const viewportContainer = document.getElementById('viewportContainer');
  const timelineSlider = document.getElementById('timelineSlider');
  const currentTimestamp = document.getElementById('currentTimestamp');
  const currentLocalTime = document.getElementById('currentLocalTime');
  const currentFrameIndex = document.getElementById('currentFrameIndex');
  const totalFrames = document.getElementById('totalFrames');
  const btnPlayPause = document.getElementById('btnPlayPause');
  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  const btnPrevFrame = document.getElementById('btnPrevFrame');
  const btnNextFrame = document.getElementById('btnNextFrame');
  const inputSearchDate = document.getElementById('inputSearchDate');
  const btnSearchDate = document.getElementById('btnSearchDate');
  const btnJumpPeak = document.getElementById('btnJumpPeak');

  // Telemetría DOM
  const statMaxRisk = document.getElementById('statMaxRisk');
  const statMeanRisk = document.getElementById('statMeanRisk');
  const statCriticalPct = document.getElementById('statCriticalPct');
  const barMaxRisk = document.getElementById('barMaxRisk');
  const barMeanRisk = document.getElementById('barMeanRisk');
  const barCriticalPct = document.getElementById('barCriticalPct');
  const globalAlertBadge = document.getElementById('globalAlertBadge');
  const statusTitle = document.getElementById('statusTitle');
  const statusPeakProb = document.getElementById('statusPeakProb');

  // Inspector Hover DOM
  const hudInspector = document.getElementById('hudInspector');
  const inspLat = document.getElementById('inspLat');
  const inspLon = document.getElementById('inspLon');
  const inspAlt = document.getElementById('inspAlt');
  const inspRisk = document.getElementById('inspRisk');

  // Controles de Cámara y Herramientas
  const exaggerationSlider = document.getElementById('exaggerationSlider');
  const exagVal = document.getElementById('exagVal');
  const btnAutoRotate = document.getElementById('btnAutoRotate');
  const btnResetView = document.getElementById('btnResetView');
  const btnScreenshot = document.getElementById('btnScreenshot');
  const modeShaded = document.getElementById('modeShaded');
  const modeWireframe = document.getElementById('modeWireframe');
  const modeContour = document.getElementById('modeContour');
  const camPreset3D = document.getElementById('camPreset3D');
  const camPresetTop = document.getElementById('camPresetTop');
  const camPresetSide = document.getElementById('camPresetSide');

  // Sidebar y Modal
  const telemetrySidebar = document.getElementById('telemetrySidebar');
  const btnToggleSidebar = document.getElementById('btnToggleSidebar');
  const btnCloseSidebar = document.getElementById('btnCloseSidebar');
  const btnModelMetrics = document.getElementById('btnModelMetrics');
  const modalMetrics = document.getElementById('modalMetrics');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const modelsComparisonGrid = document.getElementById('modelsComparisonGrid');
  const modelActiveDetails = document.getElementById('modelActiveDetails');

  // --- VARIABLES THREE.JS ---
  let scene, camera, renderer, controls;
  let terrainGeometry, terrainMesh, terrainWireframeMesh;
  let normalizedHeights = [];
  let probeMarker = null;
  let raycaster, mouse;
  let miniMap = null, mapDemBox = null, mapPointsLayer = null;

  // Paleta de Color de Riesgo IDÉNTICA al Fragment Shader de Modelos/01_XGBoost/renderer.py
  // low_risk = vec3(0.0, 0.8, 0.0)    -> Verde (Seguro)
  // mid_risk = vec3(0.9, 0.9, 0.0)    -> Amarillo (Alerta)
  // high_risk = vec3(0.9, 0.0, 0.0)   -> Rojo (Helada Crítica)
  const COLOR_LOW_RISK = new THREE.Color(0.0, 0.8, 0.0);
  const COLOR_MID_RISK = new THREE.Color(0.9, 0.9, 0.0);
  const COLOR_HIGH_RISK = new THREE.Color(0.9, 0.0, 0.0);

  function interpolateRiskColor(prob) {
    const c = new THREE.Color();
    if (prob < 0.5) {
      c.copy(COLOR_LOW_RISK).lerp(COLOR_MID_RISK, prob * 2.0);
    } else {
      c.copy(COLOR_MID_RISK).lerp(COLOR_HIGH_RISK, (prob - 0.5) * 2.0);
    }
    return c;
  }

  // --- 1. INICIALIZACIÓN ---
  async function init() {
    try {
      showLoadingNotification('Cargando modelos topográficos y datos de predicción...');
      
      const [resTerrain, resModels] = await Promise.all([
        fetch('data/terrain.json').then(r => r.json()),
        fetch('data/models_data.json').then(r => r.json())
      ]);

      state.terrain = resTerrain;
      state.models = resModels;

      initThree();
      buildTerrain();
      initMiniMap();
      populateUI();
      updateActiveModel(state.activeModelId);
      hideLoadingNotification();

      setupEventListeners();
      animate();

    } catch (err) {
      console.error('Error inicializando visualizador 3D:', err);
      alert('Error cargando datos: ' + err.message);
    }
  }

  // --- 2. THREE.JS MOTOR 3D ---
  function initThree() {
    const width = viewportContainer.clientWidth;
    const height = viewportContainer.clientHeight;

    // Escena
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x06080d);
    scene.fog = new THREE.FogExp2(0x06080d, 0.0035);

    // Cámara
    camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 2000);
    camera.position.set(0, 90, 110);

    // Renderer
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Controles Orbitales
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // No atravesar el suelo
    controls.minDistance = 15;
    controls.maxDistance = 350;
    controls.target.set(0, 0, 0);

    // Luces
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
    sunLight.position.set(60, 120, 80);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 400;
    const d = 80;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    scene.add(sunLight);

    // Luz de relleno azulada (atmósfera andina)
    const skyFillLight = new THREE.DirectionalLight(0x38bdf8, 0.4);
    skyFillLight.position.set(-60, 40, -80);
    scene.add(skyFillLight);

    // Raycaster para Hover / Sondaje
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Marcador de cursor 3D (Anillo pulso)
    const ringGeo = new THREE.RingGeometry(0.8, 1.2, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ffaa, side: THREE.DoubleSide });
    probeMarker = new THREE.Mesh(ringGeo, ringMat);
    probeMarker.visible = false;
    scene.add(probeMarker);

    window.addEventListener('resize', onWindowResize);
  }

  // --- 3. CONSTRUCCIÓN DE LA MALLA DEL TERRENO ---
  function buildTerrain() {
    const grid = state.terrain.grid_size; // [128, 128]
    const cols = grid[0];
    const rows = grid[1];
    const heights = state.terrain.heights;
    const minZ = state.terrain.elevation_min; // 3812m
    const maxZ = state.terrain.elevation_max; // 5400m
    const rangeZ = maxZ - minZ || 1;

    // PlaneGeometry en XZ: ancho 100 x largo 100 con 127 subdivisiones
    terrainGeometry = new THREE.PlaneGeometry(100, 100, cols - 1, rows - 1);
    terrainGeometry.rotateX(-Math.PI / 2);

    const pos = terrainGeometry.attributes.position;
    normalizedHeights = new Float32Array(pos.count);
    const colors = new Float32Array(pos.count * 3);

    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rawH = heights[r][c];
        const normH = (rawH - minZ) / rangeZ;
        normalizedHeights[idx] = normH;

        // Altura Z escalada por la exageración
        pos.setY(idx, normH * 16.0 * state.exaggeration);

        // Color inicial verde
        colors[idx * 3] = 0.06;
        colors[idx * 3 + 1] = 0.72;
        colors[idx * 3 + 2] = 0.5;

        idx++;
      }
    }

    terrainGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    terrainGeometry.computeVertexNormals();

    // Material Sombreado Principal
    const terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.75,
      metalness: 0.15,
      flatShading: false
    });

    terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    scene.add(terrainMesh);

    // Material Wireframe (Opcional, estilo PyOpenGL clásico)
    const wireMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      wireframe: true
    });
    terrainWireframeMesh = new THREE.Mesh(terrainGeometry, wireMat);
    terrainWireframeMesh.visible = false;
    scene.add(terrainWireframeMesh);

    // Base inferior / pedestal estético
    const baseGeo = new THREE.BoxGeometry(101, 3, 101);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x090d15, roughness: 0.9 });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = -1.6;
    scene.add(baseMesh);
  }

  // Actualiza la altura vertical cuando cambia el slider de exageración
  function updateExaggeration(factor) {
    state.exaggeration = factor;
    exagVal.textContent = factor.toFixed(1) + 'x';
    const pos = terrainGeometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, normalizedHeights[i] * 16.0 * factor);
    }
    pos.needsUpdate = true;
    terrainGeometry.computeVertexNormals();
  }

  // --- 4. ACTUALIZACIÓN DINÁMICA DE LA SIMULACIÓN DE HELADAS ---
  function updateSimulationFrame(frameIndex) {
    const model = state.models[state.activeModelId];
    if (!model || !model.frames || model.frames.length === 0) return;

    state.activeFrameIndex = Math.max(0, Math.min(model.frames.length - 1, frameIndex));
    const frame = model.frames[state.activeFrameIndex];

    // 1. Actualizar Textos y Sliders de la Barra Temporal
    timelineSlider.value = state.activeFrameIndex;
    currentTimestamp.textContent = frame.timestamp;
    currentFrameIndex.textContent = state.activeFrameIndex + 1;
    totalFrames.textContent = model.frames.length;

    // Calcular hora local estimada (Puno UTC-5)
    try {
      const dt = new Date(frame.timestamp.replace(' ', 'T'));
      if (!isNaN(dt.getTime())) {
        const localHour = (dt.getUTCHours() - 5 + 24) % 24;
        currentLocalTime.textContent = `(${String(localHour).padStart(2, '0')}:00 Hora Local Puno UTC-5)`;
      }
    } catch (_) {}

    // 2. Aplicar Colores de Riesgo a los Vértices 3D
    applyFrostHeatmap(frame.dem_grid);

    // 3. Actualizar Telemetría y Gauges en HUD
    updateTelemetryStats(frame.stats);

    // 4. Actualizar Mini-Mapa 2D
    updateMiniMapData(frame);
  }

  function applyFrostHeatmap(demGrid32x32) {
    const gridRes = state.terrain.grid_size; // [128, 128]
    const cols = gridRes[0];
    const rows = gridRes[1];
    const colors = terrainGeometry.attributes.color.array;

    const gH = demGrid32x32.length;
    const gW = demGrid32x32[0].length;

    let idx = 0;
    for (let r = 0; r < rows; r++) {
      // Coordenada Y en demGrid
      const vY = (r / (rows - 1)) * (gH - 1);
      const y0 = Math.floor(vY);
      const y1 = Math.min(gH - 1, y0 + 1);
      const dy = vY - y0;

      for (let c = 0; c < cols; c++) {
        // Coordenada X en demGrid
        const vX = (c / (cols - 1)) * (gW - 1);
        const x0 = Math.floor(vX);
        const x1 = Math.min(gW - 1, x0 + 1);
        const dx = vX - x0;

        // Interpolación bilineal del riesgo
        const p00 = demGrid32x32[y0][x0];
        const p10 = demGrid32x32[y0][x1];
        const p01 = demGrid32x32[y1][x0];
        const p11 = demGrid32x32[y1][x1];

        const pTop = p00 * (1 - dx) + p10 * dx;
        const pBottom = p01 * (1 - dx) + p11 * dx;
        const prob = pTop * (1 - dy) + pBottom * dy;

        let col;
        if (state.renderMode === 'contour') {
          // Modo hipsométrico / relieve
          const normH = normalizedHeights[idx];
          col = new THREE.Color().setHSL(0.35 - normH * 0.35, 0.8, 0.45);
        } else {
          // Modo riesgo térmico de helada
          col = interpolateRiskColor(prob);
        }

        colors[idx * 3] = col.r;
        colors[idx * 3 + 1] = col.g;
        colors[idx * 3 + 2] = col.b;

        idx++;
      }
    }

    terrainGeometry.attributes.color.needsUpdate = true;
  }

  function updateTelemetryStats(stats) {
    const maxPct = (stats.max * 100).toFixed(1);
    const meanPct = (stats.mean * 100).toFixed(1);
    const critPct = stats.critical_pct.toFixed(1);

    statMaxRisk.textContent = `${maxPct}%`;
    statMeanRisk.textContent = `${meanPct}%`;
    statCriticalPct.textContent = `${critPct}%`;

    barMaxRisk.style.width = `${Math.min(100, maxPct)}%`;
    barMeanRisk.style.width = `${Math.min(100, meanPct)}%`;
    barCriticalPct.style.width = `${Math.min(100, critPct)}%`;

    // Estado del badge global en header
    globalAlertBadge.className = 'alert-status-box';
    if (stats.max >= 0.75 || stats.critical_pct >= 30) {
      globalAlertBadge.classList.add('critical');
      statusTitle.textContent = 'PELIGRO DE HELADA CRÍTICA';
      statusTitle.style.color = '#ef4444';
    } else if (stats.max >= 0.4) {
      statusTitle.textContent = 'ALERTA METEOROLÓGICA';
      statusTitle.style.color = '#eab308';
    } else {
      globalAlertBadge.classList.add('safe');
      statusTitle.textContent = 'CONDICIONES NORMALES';
      statusTitle.style.color = '#10b981';
    }
    statusPeakProb.textContent = `Prob. Pico: ${maxPct}%`;
  }

  // --- 6. CAMBIO DE MODELO ---
  function updateActiveModel(modelId) {
    if (!state.models[modelId]) return;
    state.activeModelId = modelId;

    // Actualizar botones de selector
    document.querySelectorAll('.model-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.model === modelId);
    });

    const model = state.models[modelId];
    timelineSlider.max = model.frames.length - 1;

    // Actualizar bloque de información del modelo en sidebar
    modelActiveDetails.innerHTML = `
      <div class="model-title-badge" style="color: ${model.color}">${model.name}</div>
      <div style="font-size: 10px; color: #38bdf8; margin-bottom: 6px;">${model.type} • ${model.badge}</div>
      <p>${model.description}</p>
      <div class="metrics-mini-table">
        <div class="mini-metric">
          <div class="m-lbl">Accuracy</div>
          <div class="m-val">${model.metrics.accuracy}</div>
        </div>
        <div class="mini-metric">
          <div class="m-lbl">ROC-AUC</div>
          <div class="m-val">${model.metrics.roc_auc}</div>
        </div>
        <div class="mini-metric">
          <div class="m-lbl">CSI Index</div>
          <div class="m-val">${model.metrics.csi}</div>
        </div>
        <div class="mini-metric">
          <div class="m-lbl">Brier Loss</div>
          <div class="m-val">${model.metrics.brier}</div>
        </div>
      </div>
    `;

    // Restablecer al frame 0 o mantener si cabe
    const targetFrame = Math.min(state.activeFrameIndex, model.frames.length - 1);
    updateSimulationFrame(targetFrame);
  }

  // --- 7. MINI-MAPA LEAFLET 2D ---
  function initMiniMap() {
    const mapEl = document.getElementById('miniMap');
    if (!mapEl) return;

    // Centrado en Puno / Lago Titicaca (-15.5, -70.5)
    miniMap = L.map('miniMap', {
      zoomControl: false,
      attributionControl: false
    }).setView([-15.5, -70.5], 7);

    // Capa base de OpenStreetMap
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
    }).addTo(miniMap);

    // Polígono del área de predicción idéntica a Modelos/01_XGBoost/renderer.py
    // ÁREA (LAT): -18.0000° a -13.0000° | (LON): -72.0000° a -68.0000°
    const bounds = [
      [-18.0, -72.0], // Suroeste
      [-13.0, -68.0]  // Noreste
    ];

    mapDemBox = L.rectangle(bounds, {
      color: '#00ffaa',
      weight: 2,
      fillColor: '#00ffaa',
      fillOpacity: 0.15,
      dashArray: '4, 4'
    }).addTo(miniMap);

    // Layer de puntos regionales
    mapPointsLayer = L.layerGroup().addTo(miniMap);
  }

  function updateMiniMapData(frame) {
    if (!mapPointsLayer || !frame.regional_samples) return;
    mapPointsLayer.clearLayers();

    frame.regional_samples.forEach(pt => {
      const col = interpolateRiskColor(pt.p).getHexString();
      const circle = L.circleMarker([pt.lat, pt.lon], {
        radius: 3,
        color: '#' + col,
        fillColor: '#' + col,
        fillOpacity: 0.75,
        weight: 1
      });
      circle.bindTooltip(`Lat: ${pt.lat}, Lon: ${pt.lon}<br>Prob: ${(pt.p * 100).toFixed(1)}%`);
      mapPointsLayer.addLayer(circle);
    });
  }

  // --- 8. REPRODUCTOR TEMPORAL Y EVENTOS ---
  function togglePlay() {
    state.isPlaying = !state.isPlaying;
    if (state.isPlaying) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
      showToast("▶ Simulación en reproducción", "info");
      state.playInterval = setInterval(() => {
        const model = state.models[state.activeModelId];
        const next = (state.activeFrameIndex + 1) % model.frames.length;
        updateSimulationFrame(next);
      }, state.playSpeed);
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
      clearInterval(state.playInterval);
      state.playInterval = null;
      showToast("⏸ Simulación pausada", "info");
    }
  }

  // Notificaciones Toast (Heurística 1 de Nielsen: Visibilidad del Sistema)
  // Duración reducida a menos de 1 segundo (800ms) y posibilidad de omitir de inmediato
  function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    
    // Evitar acumulación: mantener máximo 2 notificaciones activas
    if (container.children.length >= 2) {
      const oldest = container.firstElementChild;
      if (oldest) oldest.remove();
    }

    const toast = document.createElement("div");
    toast.className = `toast-message toast-${type}`;
    toast.title = "Haz clic para omitir";
    toast.innerHTML = `
      <span class="toast-text">${message}</span>
      <button class="toast-close" title="Omitir">&times;</button>
    `;
    container.appendChild(toast);

    let dismissed = false;
    const dismiss = (e) => {
      if (e) e.stopPropagation();
      if (dismissed) return;
      dismissed = true;
      clearTimeout(timer);
      toast.style.animation = "toastOut 0.15s forwards ease";
      setTimeout(() => toast.remove(), 150);
    };

    // Omitir al hacer clic en cualquier parte de la notificación o en la cruz
    toast.addEventListener("click", dismiss);

    // Auto-cierre antes de 1 segundo (800ms)
    const timer = setTimeout(dismiss, 800);
  }

  function setupEventListeners() {
    // Model Selector Pills
    document.querySelectorAll('.model-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        updateActiveModel(btn.dataset.model);
        const model = state.models[btn.dataset.model];
        if (model) showToast(`Modelo seleccionado: ${model.name}`, "info");
      });
    });

    // Timeline Slider
    timelineSlider.addEventListener('input', (e) => {
      updateSimulationFrame(parseInt(e.target.value, 10));
    });

    // Playback Controls
    btnPlayPause.addEventListener('click', togglePlay);
    btnNextFrame.addEventListener('click', () => {
      const model = state.models[state.activeModelId];
      updateSimulationFrame((state.activeFrameIndex + 1) % model.frames.length);
    });
    btnPrevFrame.addEventListener('click', () => {
      const model = state.models[state.activeModelId];
      const prev = (state.activeFrameIndex - 1 + model.frames.length) % model.frames.length;
      updateSimulationFrame(prev);
    });

    // Velocidad de reproducción
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const s = parseInt(btn.dataset.speed, 10);
        state.playSpeed = 1000 / s;
        showToast(`Velocidad de reproducción ajustada a ${s}x`, "info");
        if (state.isPlaying) {
          togglePlay();
          togglePlay();
        }
      });
    });

    // Salto al pico crítico (Heurística 7: Flexibilidad y Eficiencia)
    btnJumpPeak.addEventListener('click', () => {
      const model = state.models[state.activeModelId];
      let maxProb = -1;
      let peakIdx = 0;
      model.frames.forEach((f, idx) => {
        if (f.stats.max > maxProb) {
          maxProb = f.stats.max;
          peakIdx = idx;
        }
      });
      updateSimulationFrame(peakIdx);
      showToast(`⚡ Mostrando momento de helada crítica (${(maxProb * 100).toFixed(1)}% riesgo máx)`, "warn");
    });

    // Búsqueda de Fecha por Teclado (Heurísticas 5 y 9: Prevención y Diagnóstico de Errores)
    function executeDateSearch() {
      const query = inputSearchDate.value.trim().toLowerCase();
      if (!query) return;
      const model = state.models[state.activeModelId];
      const foundIdx = model.frames.findIndex(f => f.timestamp.toLowerCase().includes(query));
      if (foundIdx !== -1) {
        updateSimulationFrame(foundIdx);
        inputSearchDate.style.borderColor = '#10b981';
        showToast(`✓ Fecha encontrada: ${model.frames[foundIdx].timestamp}`, "success");
      } else {
        inputSearchDate.style.borderColor = '#ef4444';
        setTimeout(() => { inputSearchDate.style.borderColor = ''; }, 1500);
        showToast(`❌ No se encontró esa fecha. Prueba con '2020-06-15 05:00:00' o el botón 'Pico Crítico'`, "error");
      }
    }

    btnSearchDate.addEventListener('click', executeDateSearch);
    inputSearchDate.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') executeDateSearch();
    });

    // Atajos de Teclado Globales (Heurística 7: Flexibilidad y Eficiencia)
    window.addEventListener('keydown', (e) => {
      if (document.activeElement === inputSearchDate) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        const model = state.models[state.activeModelId];
        updateSimulationFrame((state.activeFrameIndex + 1) % model.frames.length);
      } else if (e.code === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        const model = state.models[state.activeModelId];
        const prev = (state.activeFrameIndex - 1 + model.frames.length) % model.frames.length;
        updateSimulationFrame(prev);
      } else if (e.key === 'w' || e.key === 'W') {
        modeWireframe.click();
      } else if (e.key === 's' || e.key === 'S') {
        modeShaded.click();
      } else if (e.key === 'r' || e.key === 'R') {
        btnResetView.click();
      } else if (e.key === 'Escape') {
        modalMetrics.classList.add('hidden');
        const modalHelp = document.getElementById('modalHelp');
        if (modalHelp) modalHelp.classList.add('hidden');
        telemetrySidebar.classList.add('collapsed');
      }
    });

    // Modos de Renderizado
    modeShaded.addEventListener('click', () => {
      state.renderMode = 'shaded';
      terrainMesh.visible = true;
      terrainWireframeMesh.visible = false;
      setActiveModeBtn(modeShaded);
      updateSimulationFrame(state.activeFrameIndex);
      showToast("Modo Superficie Sombreada activado", "info");
    });

    modeWireframe.addEventListener('click', () => {
      state.renderMode = 'wireframe';
      terrainMesh.visible = false;
      terrainWireframeMesh.visible = true;
      setActiveModeBtn(modeWireframe);
      updateSimulationFrame(state.activeFrameIndex);
      showToast("Modo Malla Wireframe activado (PyOpenGL clásico)", "info");
    });

    modeContour.addEventListener('click', () => {
      state.renderMode = 'contour';
      terrainMesh.visible = true;
      terrainWireframeMesh.visible = false;
      setActiveModeBtn(modeContour);
      updateSimulationFrame(state.activeFrameIndex);
      showToast("Modo Hipsométrico / Relieve activado", "info");
    });

    function setActiveModeBtn(activeBtn) {
      [modeShaded, modeWireframe, modeContour].forEach(b => b.classList.remove('active'));
      activeBtn.classList.add('active');
    }

    // Presets de Cámara
    camPreset3D.addEventListener('click', () => {
      controls.reset();
      camera.position.set(0, 90, 110);
      controls.target.set(0, 0, 0);
      showToast("Perspectiva 3D libre", "info");
    });

    camPresetTop.addEventListener('click', () => {
      camera.position.set(0, 140, 0.001);
      controls.target.set(0, 0, 0);
      showToast("Vista Cenital (Norte arriba)", "info");
    });

    camPresetSide.addEventListener('click', () => {
      camera.position.set(0, 20, 120);
      controls.target.set(0, 10, 0);
      showToast("Perfil lateral del relieve", "info");
    });

    // Control de Exageración Z
    exaggerationSlider.addEventListener('input', (e) => {
      updateExaggeration(parseFloat(e.target.value));
    });

    // Auto Rotación
    btnAutoRotate.addEventListener('click', () => {
      state.autoRotate = !state.autoRotate;
      controls.autoRotate = state.autoRotate;
      controls.autoRotateSpeed = 1.2;
      btnAutoRotate.classList.toggle('active', state.autoRotate);
      showToast(state.autoRotate ? "Auto-rotación activada" : "Auto-rotación pausada", "info");
    });

    btnResetView.addEventListener('click', () => {
      controls.reset();
      camera.position.set(0, 90, 110);
      controls.target.set(0, 0, 0);
      showToast("Vista restablecida a posición inicial", "info");
    });

    // Captura de Pantalla
    btnScreenshot.addEventListener('click', () => {
      renderer.render(scene, camera);
      const dataURL = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = `heladas_altiplano_${state.activeModelId}_frame${state.activeFrameIndex}.png`;
      a.click();
      showToast("📸 Captura de pantalla descargada en alta resolución", "success");
    });

    // Sondaje de Coordenadas (Cursor en Desktop y Toque en Móviles)
    viewportContainer.addEventListener('mousemove', onCanvasPointerEvent);
    canvas.addEventListener('click', onCanvasPointerEvent);
    canvas.addEventListener('touchstart', onCanvasPointerEvent, { passive: true });

    // Botones de Minimización de HUD y Leyenda (Heurística 8: Diseño Minimalista)
    const btnToggleHudGeo = document.getElementById('btnToggleHudGeo');
    const hudOverlayGeo = document.getElementById('hudOverlayGeo');
    if (btnToggleHudGeo && hudOverlayGeo) {
      btnToggleHudGeo.addEventListener('click', () => {
        hudOverlayGeo.classList.toggle('collapsed-hud');
        btnToggleHudGeo.querySelector('.min-icon').textContent = hudOverlayGeo.classList.contains('collapsed-hud') ? '+' : '−';
      });
    }

    const btnToggleLegend = document.getElementById('btnToggleLegend');
    const riskLegendBox = document.getElementById('riskLegendBox');
    if (btnToggleLegend && riskLegendBox) {
      btnToggleLegend.addEventListener('click', () => {
        riskLegendBox.classList.toggle('collapsed-hud');
        btnToggleLegend.querySelector('.min-icon').textContent = riskLegendBox.classList.contains('collapsed-hud') ? '+' : '−';
      });
    }

    const btnCloseInspector = document.getElementById('btnCloseInspector');
    if (btnCloseInspector) {
      btnCloseInspector.addEventListener('click', () => {
        probeMarker.visible = false;
        hudInspector.style.opacity = '0';
      });
    }

    // Sidebar Toggle
    btnToggleSidebar.addEventListener('click', () => {
      telemetrySidebar.classList.toggle('collapsed');
      setTimeout(onWindowResize, 350);
    });
    btnCloseSidebar.addEventListener('click', () => {
      telemetrySidebar.classList.add('collapsed');
      setTimeout(onWindowResize, 350);
    });

    // Modal de Métricas
    btnModelMetrics.addEventListener('click', () => {
      modalMetrics.classList.remove('hidden');
    });
    btnCloseModal.addEventListener('click', () => {
      modalMetrics.classList.add('hidden');
    });
    modalMetrics.addEventListener('click', (e) => {
      if (e.target === modalMetrics) modalMetrics.classList.add('hidden');
    });

    // Modal de Ayuda (Heurística 10 de Nielsen)
    const btnOpenHelp = document.getElementById('btnOpenHelp');
    const modalHelp = document.getElementById('modalHelp');
    const btnCloseHelpModal = document.getElementById('btnCloseHelpModal');
    if (btnOpenHelp && modalHelp) {
      btnOpenHelp.addEventListener('click', () => {
        modalHelp.classList.remove('hidden');
      });
    }
    if (btnCloseHelpModal && modalHelp) {
      btnCloseHelpModal.addEventListener('click', () => {
        modalHelp.classList.add('hidden');
      });
    }
    if (modalHelp) {
      modalHelp.addEventListener('click', (e) => {
        if (e.target === modalHelp) modalHelp.classList.add('hidden');
      });
    }
  }

  // --- 9. INSPECTOR DE CURSOR / TOQUE TÁCTIL (RAYCASTING ADAPTATIVO) ---
  function onCanvasPointerEvent(event) {
    const clientX = event.clientX || (event.touches && event.touches[0] ? event.touches[0].clientX : null);
    const clientY = event.clientY || (event.touches && event.touches[0] ? event.touches[0].clientY : null);
    if (clientX === null || clientY === null) return;

    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(terrainMesh);

    if (intersects.length > 0) {
      const hit = intersects[0];
      probeMarker.visible = true;
      probeMarker.position.copy(hit.point);
      probeMarker.position.y += 0.3;

      // Calcular Lat/Lon del punto de impacto en mundo
      const pctX = (hit.point.x + 50) / 100;
      const pctZ = (hit.point.z + 50) / 100;

      const b = state.terrain.bounds;
      const lon = b.lon_min + pctX * (b.lon_max - b.lon_min);
      const lat = b.lat_max - pctZ * (b.lat_max - b.lat_min);

      // Altitud estimada
      const alt = state.terrain.elevation_min + (hit.point.y / (16.0 * state.exaggeration)) * (state.terrain.elevation_max - state.terrain.elevation_min);

      // Probabilidad en ese punto en el frame activo
      const model = state.models[state.activeModelId];
      const frame = model.frames[state.activeFrameIndex];
      const gH = frame.dem_grid.length;
      const gW = frame.dem_grid[0].length;
      const r = Math.max(0, Math.min(gH - 1, Math.round(pctZ * (gH - 1))));
      const c = Math.max(0, Math.min(gW - 1, Math.round(pctX * (gW - 1))));
      const prob = frame.dem_grid[r][c];

      inspLat.textContent = `${lat.toFixed(4)}° S`;
      inspLon.textContent = `${lon.toFixed(4)}° O`;
      inspAlt.textContent = `${Math.round(alt)} m`;

      let riskCat = 'Seguro';
      let riskColor = 'rgb(0, 204, 0)';
      if (prob >= 0.75) { riskCat = 'Crítico'; riskColor = 'rgb(230, 0, 0)'; }
      else if (prob >= 0.5) { riskCat = 'Alto'; riskColor = '#f97316'; }
      else if (prob >= 0.25) { riskCat = 'Moderado'; riskColor = 'rgb(230, 230, 0)'; }

      inspRisk.textContent = `${riskCat} (${(prob * 100).toFixed(1)}%)`;
      inspRisk.style.background = riskColor + '22';
      inspRisk.style.color = riskColor;
      inspRisk.style.border = `1px solid ${riskColor}66`;

      hudInspector.style.opacity = '1';
    } else if (event.type === 'mousemove') {
      probeMarker.visible = false;
      hudInspector.style.opacity = '0.6';
    }
  }

  // --- 10. POBLAR UI DINÁMICAMENTE ---
  function populateUI() {
    // Modal de Comparativa de Modelos
    modelsComparisonGrid.innerHTML = '';
    Object.values(state.models).forEach(m => {
      const card = document.createElement('div');
      card.className = `compare-card ${m.id === state.activeModelId ? 'active-model' : ''}`;
      card.innerHTML = `
        <div class="compare-title" style="color: ${m.color}">${m.name}</div>
        <div class="compare-badge" style="background: ${m.color}22; color: ${m.color}; border: 1px solid ${m.color}66">${m.badge}</div>
        <p style="font-size: 11px; color: var(--text-muted);">${m.description}</p>
        <div class="compare-stats">
          <div class="compare-row"><span>Accuracy:</span> <strong>${m.metrics.accuracy}</strong></div>
          <div class="compare-row"><span>ROC-AUC:</span> <strong>${m.metrics.roc_auc}</strong></div>
          <div class="compare-row"><span>CSI Index:</span> <strong style="color: #00ffaa;">${m.metrics.csi}</strong></div>
          <div class="compare-row"><span>Brier Score:</span> <strong>${m.metrics.brier}</strong></div>
          <div class="compare-row"><span>Precision:</span> <strong>${m.metrics.precision}</strong></div>
          <div class="compare-row"><span>Recall:</span> <strong>${m.metrics.recall}</strong></div>
        </div>
      `;
      modelsComparisonGrid.appendChild(card);
    });
  }

  function onWindowResize() {
    const width = viewportContainer.clientWidth;
    const height = viewportContainer.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    if (miniMap) miniMap.invalidateSize();
  }

  // --- 11. BUCLE DE RENDERIZADO ---
  function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // Pulso del marcador probeMarker
    if (probeMarker && probeMarker.visible) {
      const s = 1.0 + Math.sin(Date.now() * 0.008) * 0.15;
      probeMarker.scale.set(s, s, s);
    }

    renderer.render(scene, camera);
  }

  function showLoadingNotification(msg) {
    let loader = document.getElementById('appLoader');
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'appLoader';
      loader.style.cssText = 'position:fixed;inset:0;background:#07090e;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#00ffaa;font-family:sans-serif;font-weight:600;gap:12px;';
      loader.innerHTML = `
        <div style="width:40px;height:40px;border:3px solid #1e293b;border-top-color:#00ffaa;border-radius:50%;animation:spin 1s linear infinite;"></div>
        <div id="loaderText">${msg}</div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
      `;
      document.body.appendChild(loader);
    } else {
      document.getElementById('loaderText').textContent = msg;
    }
  }

  function hideLoadingNotification() {
    const loader = document.getElementById('appLoader');
    if (loader) loader.remove();
  }

  // Iniciar al cargar el DOM
  window.addEventListener('DOMContentLoaded', init);
})();
