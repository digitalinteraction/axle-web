@echo off
where /q http-server
if errorlevel 1 (
    echo RUN: Installing http-server
    npm i -g http-server
)
if not exist server.crt goto gen_key
if not exist key.pem goto gen_key
goto run

:gen_key
echo RUN: Generating 'server.crt' and 'key.pem'...
where /q bash
if errorlevel 1 (
    echo ERROR: 'bash' not found -- this script requires WSL.
    pause
    goto end
)
bash -c "openssl req -subj '/CN=example.com/O=Example/C=GB' -newkey rsa:2048 -new -nodes -keyout key.pem -out csr.pem && openssl x509 -req -days 365 -in csr.pem -signkey key.pem -out server.crt"
goto end

:run
http-server -S -K key.pem -C server.crt
goto end

:end
