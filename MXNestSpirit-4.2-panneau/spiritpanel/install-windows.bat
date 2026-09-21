@echo off
setlocal
title Installation MXNestSpirit
set DEST=%APPDATA%\Adobe\CEP\extensions\MXNestSpirit

echo Autorisation des extensions non signees...
for %%V in (5 6 7 8 9 10 11 12) do (
  reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)

echo Copie du panneau...
if exist "%DEST%" rmdir /S /Q "%DEST%"
mkdir "%DEST%"
xcopy /E /I /Y /Q "%~dp0*" "%DEST%" >nul
del /Q "%DEST%\install-windows.bat" "%DEST%\install-mac.command" >nul 2>&1

echo.
echo Termine. Relance Illustrator : Fenetre ^> Extensions ^> MXNestSpirit
pause
