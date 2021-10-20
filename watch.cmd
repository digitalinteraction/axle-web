@echo off
setlocal
cd /d %~dp0

::: Kill existing processes
set "FIELDS=handle^,name^,commandline"
rem taskkill /im "ngrok.exe" 2>nul
for /f "delims=, tokens=3" %%f in ('wmic path win32_process get %FIELDS% /format:csv ^| findstr /v findstr.exe ^| findstr ngrok.exe') do (
  if not "%%f"=="name" (
    echo PID/ngrok: %%f
    TASKKILL /PID %%f
  )
)
rem taskkill /im cmd.exe /fi "WINDOWTITLE eq http-server*"
for /f "delims=, tokens=3" %%f in ('wmic path win32_process get %FIELDS% /format:csv ^| findstr /v findstr.exe ^| findstr node.exe ^| findstr [lh][it][vt][ep]-server') do (
  if not "%%f"=="name" (
    echo PID/http-server: %%f
	TASKKILL /PID %%f /F
  )
)
taskkill /im WindowsTerminal.exe /fi "WINDOWTITLE eq http-server*" >nul

::: Check for required programs
where ngrok >nul
if ERRORLEVEL 1 (
  echo ERROR: ngrok not found in PATH, check it is installed from: https://ngrok.com/  -- and ensure the command window is reopened
  exit /b 1
)
set LIVE_SERVER=
for %%X in (live-server.cmd) do set LIVE_SERVER=%%~$PATH:X
if exist "./node_modules/.bin/live-server" (
  set LIVE_SERVER=./node_modules/.bin/live-server
)
if "%LIVE_SERVER%"=="" (
  echo ERROR: live-server not found in PATH or node_modules, install with:  npm i -d live-server
  exit /b 1
)

::: Run a live server on port 8080 (uses a WebSocket to indicate changes, this works through ngrok's https), and Ngrok to make available on the web
where wt.exe >nul
if errorlevel 1 goto run_cmd
:run_wt
::: Use Windows Terminal split panes to run the live server and ngrok
start "http-server-ngrok" wt new-tab --title "http-server-ngrok" -d . cmd /c "title http-server-ngrok && "%LIVE_SERVER%" --no-browser ." ; split-pane --title "http-server-ngrok" ngrok http 8080
goto wait_for_ngrok
:run_cmd
start "http-server" cmd /c "%LIVE_SERVER%" --no-browser .
start "ngrok" ngrok http 8080
goto wait_for_ngrok

::: Wait for Ngrok to start, then display Ngrok forwarding details
:wait_for_ngrok
echo.Waiting for ngrok...
choice /C 0 /D 0 /T 1 >nul
set TUNNEL=
for /F "tokens=* usebackq" %%F IN (`curl -s http://127.0.0.1:4040/api/tunnels ^| powershell -c "$input | select-string -pattern '(https://[-a-f0-9]+\.ngrok\.io)' | %% {$url = $_.matches.groups[1].value; write-output $url} " `) DO set TUNNEL=%%F
if "%TUNNEL%"=="" goto wait_for_ngrok
echo Now listening on: %TUNNEL%
set URL=%TUNNEL%#debug

::: Display QR Code of the URL (if executable is found)
set QRCODE=
for %%X in (qrcode.exe) do set QRCODE=%%~$PATH:X
if defined QRCODE "%QRCODE%" --invert --output:medium "%URL%"
echo.%URL%

::: Start remote browser tab (otherwise: can use local "Send to your devices") -- chrome://inspect#devices
where adb >nul
if errorlevel 1 (
  echo WARNING: adb not found.
  goto skip_adb
)
adb devices -l | findstr "device:"
if errorlevel 1 (
  echo WARNING: no adb devices found
  goto no_devices
)
adb shell am start -n com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity -d "%URL%" --activity-clear-task
:skip_adb

::: Start local browser
set CHROME=%PROGRAMFILES(x86)%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" (
  echo WARNING: Chrome not found.
  goto skip_chrome
)
rem   "%CHROME%" --remote-debugging-port=9222 --user-data-dir=remote-debug-profile "%URL%"
:skip_chrome

::: Start Android screen mirroring (if not running)
tasklist /FI "IMAGENAME eq scrcpy.exe" | findstr "Image Name" > NUL
if not errorlevel 1 (
  echo NOTE: Screen mirroring already active
  goto skip_mirror
)
set SCRCPY=
for %%X in (scrcpy-noconsole.vbs) do set SCRCPY=%%~$PATH:X
if not defined SCRCPY (
  echo NOTE: Screen mirroring executable not found in path.
  goto skip_mirror
)
if exist "%SCRCPY%" (
  CD /D "%SCRCPY%\.."
  "%SCRCPY%
)
:skip_mirror

::: Delay - useful if launched as a preTask from VS Code before attaching to remote debugger
ECHO Waiting 5 seconds...
CHOICE /C 0 /D 0 /T 5 >NUL

echo NOTE: Will live reload any changes to the source files. (This project has no build process to watch.)
