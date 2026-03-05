@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "ICON_FILE=%CD%\icon_installer.ico"
set "ICON_YAML=%ICON_FILE:\=/%"
set "OUT_DIR=%CD%\dist\installer"
set "BUILD_CONFIG=%TEMP%\aim-electron-builder-%RANDOM%%RANDOM%.yml"

if not exist "%ICON_FILE%" (
  echo [ERROR] Icon file not found: %ICON_FILE%
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] pnpm is not installed or not in PATH.
  exit /b 1
)

echo [1/4] Installing dependencies...
call pnpm install
if errorlevel 1 (
  echo [ERROR] pnpm install failed.
  exit /b 1
)

echo [2/4] Building all packages...
call pnpm build
if errorlevel 1 (
  echo [ERROR] pnpm build failed.
  exit /b 1
)

echo [3/4] Writing temporary electron-builder config...
(
  echo appId: com.autoinstallmanager.app
  echo productName: AutoInstallManager
  echo directories:
  echo   output: "../../dist/installer"
  echo files:
  echo   - from: dist
  echo     to: apps/main/dist
  echo     filter:
  echo       - "**/*"
  echo   - from: ../preload/dist
  echo     to: apps/preload/dist
  echo     filter:
  echo       - "**/*"
  echo   - from: ../renderer/dist
  echo     to: apps/renderer/dist
  echo     filter:
  echo       - "**/*"
  echo   - package.json
  echo   - node_modules/**/*
  echo extraResources:
  echo   - from: ../../catalog
  echo     to: catalog
  echo     filter:
  echo       - "**/*"
  echo extraMetadata:
  echo   main: apps/main/dist/index.cjs
  echo asar: true
  echo win:
  echo   target:
  echo     - target: nsis
  echo       arch:
  echo         - x64
  echo   icon: "%ICON_YAML%"
  echo artifactName: "${productName}-Setup-${version}-${arch}.${ext}"
  echo nsis:
  echo   oneClick: false
  echo   allowToChangeInstallationDirectory: true
  echo   installerIcon: "%ICON_YAML%"
  echo   uninstallerIcon: "%ICON_YAML%"
  echo   createDesktopShortcut: true
  echo   createStartMenuShortcut: true
) > "%BUILD_CONFIG%"

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

echo [4/4] Building Windows installer...
call pnpm exec electron-builder --projectDir "apps/main" --config "%BUILD_CONFIG%" --publish never
set "BUILD_EXIT=%ERRORLEVEL%"

del /f /q "%BUILD_CONFIG%" >nul 2>nul

if not "%BUILD_EXIT%"=="0" (
  echo [ERROR] Installer build failed.
  exit /b %BUILD_EXIT%
)

echo [DONE] Installer created in: %OUT_DIR%
exit /b 0
