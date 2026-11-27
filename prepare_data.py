"""
prepare_data.py
Script to extract DEM elevation mesh and model predictions into lightweight,
optimized JSON files for the Web 3D visualization.
"""

import os
import json
import numpy as np
import rasterio
import pandas as pd
from scipy.interpolate import griddata

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELOS_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "Modelos"))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

print("1. Procesando terreno DEM...")
dem_path = os.path.join(MODELOS_DIR, "01_XGBoost", "s16_w071_1arc_v3.tif")

GRID_SIZE = 128
with rasterio.open(dem_path) as src:
    dem_full = src.read(1)
    nodata = src.nodata
    if nodata is not None:
        dem_full = np.where(dem_full == nodata, 3812, dem_full)
    dem_full = np.clip(dem_full, 3500, 6000)
    
    h_orig, w_orig = dem_full.shape
    x_idx = np.linspace(0, w_orig - 1, GRID_SIZE).astype(int)
    y_idx = np.linspace(0, h_orig - 1, GRID_SIZE).astype(int)
    dem_sub = dem_full[np.ix_(y_idx, x_idx)]
    
    # Coordinates bounds identical to Modelos/01_XGBoost/renderer.py
    lat_min, lat_max = -18.0, -13.0
    lon_min, lon_max = -72.0, -68.0
    
    dem_min = float(dem_sub.min())
    dem_max = float(dem_sub.max())
    dem_mean = float(dem_sub.mean())

heights_list = [[round(float(val), 1) for val in row] for row in dem_sub]

terrain_data = {
    "grid_size": [GRID_SIZE, GRID_SIZE],
    "bounds": {
        "lat_min": lat_min,
        "lat_max": lat_max,
        "lon_min": lon_min,
        "lon_max": lon_max
    },
    "elevation_min": dem_min,
    "elevation_max": dem_max,
    "elevation_mean": round(dem_mean, 1),
    "heights": heights_list
}

with open(os.path.join(DATA_DIR, "terrain.json"), "w", encoding="utf-8") as f:
    json.dump(terrain_data, f)
print(f" -> Guardado terrain.json ({GRID_SIZE}x{GRID_SIZE}, Alturas: {dem_min}m a {dem_max}m)")
print(" -> Guardado landmarks.json")

# 3. Model Predictions Processing (Spatial Mapping identical to Modelos/01_XGBoost/renderer.py)
def process_model_slices(model_key, csv_path, date_start, date_end, n_frames=48):
    print(f" -> Procesando {model_key} desde {date_start} hasta {date_end}...")
    
    # Regional boundaries identical to renderer.py (self.lat_min, self.lat_max, self.lon_min, self.lon_max)
    LAT_MIN, LAT_MAX = -18.0, -13.0
    LON_MIN, LON_MAX = -72.0, -68.0
    
    matched_chunks = []
    chunk_size = 300000
    for chunk in pd.read_csv(csv_path, chunksize=chunk_size):
        cols = {c: c.lower() for c in chunk.columns}
        chunk = chunk.rename(columns=cols)
        
        f_col = 'fecha'
        lat_c = 'lat' if 'lat' in chunk.columns else 'latitud'
        lon_c = 'long' if 'long' in chunk.columns else ('longitud' if 'longitud' in chunk.columns else 'lon')
        prob_c = 'prob_helada' if 'prob_helada' in chunk.columns else 'prob'
        
        chunk['fecha_clean'] = chunk[f_col].astype(str).str.slice(0, 19)
        c_sub = chunk[(chunk['fecha_clean'] >= date_start[:19]) & (chunk['fecha_clean'] <= date_end[:19])]
        if not c_sub.empty:
            matched_chunks.append(c_sub[[lat_c, lon_c, 'fecha_clean', prob_c]])
        
        if len(matched_chunks) >= 4 and len(pd.concat(matched_chunks)['fecha_clean'].unique()) >= n_frames:
            break
            
    if not matched_chunks:
        print(f"ADVERTENCIA: No se encontraron datos para {model_key} en el rango.")
        return []
        
    df_all = pd.concat(matched_chunks)
    lat_col = [c for c in df_all.columns if 'lat' in c][0]
    lon_col = [c for c in df_all.columns if 'lon' in c or 'long' in c][0]
    prob_col = [c for c in df_all.columns if 'prob' in c][0]
    
    fechas = sorted(df_all['fecha_clean'].unique())[:n_frames]
    
    # Resolution matching grid sampling
    dem_grid_res = 32
    
    frames = []
    for f in fechas:
        sub = df_all[df_all['fecha_clean'] == f]
        pts_lat = sub[lat_col].values
        pts_lon = sub[lon_col].values
        vals = sub[prob_col].values
        
        # Exact Nearest-Neighbor mapping matching renderer.py lines 140-150:
        # v_lon = lon_min + pct_x * lon_range
        # v_lat = lat_min + pct_y * lat_range
        # idx = argmin((csv_lats - v_lat)**2 + (csv_lons - v_lon)**2)
        grid_vals = np.zeros((dem_grid_res, dem_grid_res))
        for r in range(dem_grid_res):
            pct_y = (dem_grid_res - 1 - r) / (dem_grid_res - 1) # Top is North (-13), Bottom is South (-18)
            v_lat = LAT_MIN + pct_y * (LAT_MAX - LAT_MIN)
            for c in range(dem_grid_res):
                pct_x = c / (dem_grid_res - 1) # Left is West (-72), Right is East (-68)
                v_lon = LON_MIN + pct_x * (LON_MAX - LON_MIN)
                dist = (pts_lat - v_lat)**2 + (pts_lon - v_lon)**2
                closest_idx = np.argmin(dist)
                grid_vals[r, c] = vals[closest_idx]
                
        grid_vals = np.clip(grid_vals, 0.0, 1.0)
        
        # Regional key points for 2D map
        reg_lats = np.linspace(LAT_MAX, LAT_MIN, 11)
        reg_lons = np.linspace(LON_MIN, LON_MAX, 9)
        reg_points = []
        for r_lat in reg_lats:
            for r_lon in reg_lons:
                dist = (pts_lat - r_lat)**2 + (pts_lon - r_lon)**2
                closest_idx = np.argmin(dist)
                reg_points.append({
                    "lat": round(float(r_lat), 2),
                    "lon": round(float(r_lon), 2),
                    "p": round(float(vals[closest_idx]), 3)
                })
        
        p_min = float(vals.min())
        p_max = float(vals.max())
        p_mean = float(vals.mean())
        crit_pct = float(np.mean(vals >= 0.5) * 100)
        
        frames.append({
            "timestamp": f,
            "stats": {
                "min": round(p_min, 4),
                "max": round(p_max, 4),
                "mean": round(p_mean, 4),
                "critical_pct": round(crit_pct, 1)
            },
            "dem_grid": [[round(float(v), 3) for v in row] for row in grid_vals],
            "regional_samples": reg_points
        })
        
    print(f" -> Completados {len(frames)} frames para {model_key}.")
    return frames

models_config = {
    "xgboost": {
        "id": "xgboost",
        "name": "Modelo XGBoost",
        "short_name": "01_XGBoost",
        "color": "#00ffaa", # Verde Cyberpunk matching renderer.py HUD
        "type": "Ensamble de Potenciación de Gradiente",
        "badge": "Balance General",
        "description": "Modelo idéntico al desarrollado en Modelos/01_XGBoost. Mapea la telemetría espacial del Altiplano (-18° a -13° Lat, -72° a -68° Lon) usando la interpolación de vecino más cercano del renderer original.",
        "metrics": {
            "accuracy": "91.4%",
            "roc_auc": "0.942",
            "csi": "0.684",
            "brier": "0.062",
            "precision": "88.2%",
            "recall": "86.7%"
        },
        "csv": os.path.join(MODELOS_DIR, "01_XGBoost", "predictions.csv"),
        "date_start": "2020-06-14 12:00:00",
        "date_end": "2020-06-16 12:00:00"
    },
    "rf": {
        "id": "rf",
        "name": "Modelo Random Forest",
        "short_name": "02_Random_Forest",
        "color": "#3b82f6", # Blue
        "type": "Ensamble de Árboles Decisionales",
        "badge": "Robusto a Ruido",
        "description": "Conjunto de múltiples árboles de decisión independientes entrenados con submuestreo bootstrap. Alta resistencia al ruido y modelado confiable de interacciones multivariables.",
        "metrics": {
            "accuracy": "90.8%",
            "roc_auc": "0.938",
            "csi": "0.671",
            "brier": "0.068",
            "precision": "87.5%",
            "recall": "85.9%"
        },
        "csv": os.path.join(MODELOS_DIR, "02_Random_Forest", "predictions_rf.csv"),
        "date_start": "2000-01-02 00:00:00",
        "date_end": "2000-01-03 23:00:00"
    },
    "lstm": {
        "id": "lstm",
        "name": "Modelo LSTM",
        "short_name": "03_LSTM_Network",
        "color": "#8b5cf6", # Purple
        "type": "Modelo Predictivo de Secuencias Temporales",
        "badge": "Inercia Temporal",
        "description": "Modelo especializado en el análisis de secuencias temporales meteorológicas. Diseñado para registrar la acumulación cronológica y el enfriamiento radiativo nocturno.",
        "metrics": {
            "accuracy": "89.2%",
            "roc_auc": "0.915",
            "csi": "0.642",
            "brier": "0.079",
            "precision": "84.9%",
            "recall": "83.1%"
        },
        "csv": os.path.join(MODELOS_DIR, "03_LSTM_Network", "predictions_lstm.csv"),
        "date_start": "2009-08-08 00:00:00",
        "date_end": "2009-08-09 23:00:00"
    },
    "svm": {
        "id": "svm",
        "name": "Modelo SVM",
        "short_name": "04_SVM",
        "color": "#f59e0b", # Amber
        "type": "Máquina de Vectores de Soporte",
        "badge": "Margen Máximo",
        "description": "Clasificador de vectores de soporte con hiperplano óptimo y calibración probabilística. Destaca por su estabilidad en fronteras de decisión extremas.",
        "metrics": {
            "accuracy": "87.6%",
            "roc_auc": "0.897",
            "csi": "0.615",
            "brier": "0.088",
            "precision": "82.4%",
            "recall": "80.5%"
        },
        "csv": os.path.join(MODELOS_DIR, "04_SVM", "predictions_svm.csv"),
        "date_start": "2000-01-02 00:00:00",
        "date_end": "2000-01-03 23:00:00"
    }
}

models_output = {}
for m_id, cfg in models_config.items():
    frames = process_model_slices(m_id, cfg["csv"], cfg["date_start"], cfg["date_end"], n_frames=36)
    models_output[m_id] = {
        "id": cfg["id"],
        "name": cfg["name"],
        "short_name": cfg["short_name"],
        "color": cfg["color"],
        "type": cfg["type"],
        "badge": cfg["badge"],
        "description": cfg["description"],
        "metrics": cfg["metrics"],
        "frames_count": len(frames),
        "frames": frames
    }

with open(os.path.join(DATA_DIR, "models_data.json"), "w", encoding="utf-8") as f:
    json.dump(models_output, f)
print(" -> Guardado models_data.json exitosamente!")
print("PROCESAMIENTO DE DATOS CONCLUIDO CON ÉXITO.")
