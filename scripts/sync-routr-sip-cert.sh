#!/usr/bin/env sh
set -eu

DOMAIN="${ROUTR_SIP_CERT_DOMAIN:-sip.75.119.131.165.sslip.io}"
CADDY_CERT_DIR="${CADDY_CERT_DIR:-/var/lib/docker/volumes/caddy_caddy_data/_data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${DOMAIN}}"
TARGET_DIR="${ROUTR_CERT_DIR:-/root/fonoster-pack/fonoster-docker/config/routr-certs}"

CERT_FILE="${CADDY_CERT_DIR}/${DOMAIN}.crt"
KEY_FILE="${CADDY_CERT_DIR}/${DOMAIN}.key"

if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  echo "Missing Caddy certificate files for ${DOMAIN}" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
cp "$CERT_FILE" "$TARGET_DIR/server.crt"
cp "$KEY_FILE" "$TARGET_DIR/server.key"

chown -R 5000:5000 "$TARGET_DIR"
chmod 700 "$TARGET_DIR"
chmod 644 "$TARGET_DIR/server.crt"
chmod 600 "$TARGET_DIR/server.key"

openssl x509 -in "$TARGET_DIR/server.crt" -noout -subject -issuer -dates -ext subjectAltName
