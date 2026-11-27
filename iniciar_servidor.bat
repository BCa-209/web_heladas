@echo off
title Visualizador 3D de Heladas - Altiplano
echo ========================================================
echo  SISTEMA VISUALIZADOR 3D DE HELADAS - WEB EDITION
echo  Region: Altiplano (Puno / Juliaca)
echo  Modelos: XGBoost, Random Forest, LSTM, SVM
echo ========================================================
echo.
echo Iniciando servidor local en http://localhost:8000 ...
start "" http://localhost:8000
python -m http.server 8000 --directory "%~dp0"
pause
