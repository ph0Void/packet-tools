#!/bin/sh
set -e

echo "[packet-tools] Aplicando migraciones de base de datos..."
npm run migrate:deploy --workspace=@packet-tools/server

echo "[packet-tools] Ejecutando seed (usuario por defecto admin/admin123)..."
npm run seed --workspace=@packet-tools/server

echo "[packet-tools] Iniciando backend en el puerto ${SERVER_PORT:-7531}..."
npm run start --workspace=@packet-tools/server &

echo "[packet-tools] Iniciando frontend en el puerto ${PORT:-3090}..."
npm run start --workspace=@packet-tools/web &

wait
