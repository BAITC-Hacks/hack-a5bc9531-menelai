@echo off
chcp 65001 > nul
set DATA=%~1
if "%DATA%"=="" set DATA=..\task\data
python pipeline.py --data "%DATA%" --out output || exit /b 1
python assumption_checks.py --data "%DATA%" --out output
set GRAPH_DATA=%DATA%
python -m pytest
