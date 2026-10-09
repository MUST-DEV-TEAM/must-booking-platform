#!/usr/bin/env bash
# Email PLATFORM_ADMIN_EMAIL (through Resend, using the app's own .env) that a
# systemd unit failed. Wired in as OnFailure=must-booking-alert@%n.service.
set -uo pipefail
unit=${1:?unit name}
ENV_FILE=${ENV_FILE:-/root/must-booking-platform/infrastructure/containers/.env}
env_value() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-; }
key=$(env_value RESEND_API_KEY) from=$(env_value MAIL_FROM_EMAIL) to=$(env_value PLATFORM_ADMIN_EMAIL)
if [ -z "$key" ] || [ -z "$from" ] || [ -z "$to" ]; then
  echo "Resend settings missing in $ENV_FILE; cannot email about $unit." >&2
  exit 1
fi
log=$(journalctl -u "$unit" -n 15 --no-pager -o cat | tr '"\' "'/" | sed ':a;N;$!ba;s/\n/\n/g')
curl -fsS -m 30 https://api.resend.com/emails \
  -H "Authorization: Bearer $key" -H 'Content-Type: application/json' \
  --data "{\"from\":\"$from\",\"to\":[\"$to\"],\"subject\":\"booking.must.al: $unit FAILED\",\"text\":\"$unit failed on $(hostname).\n\nLast log lines:\n$log\"}" >/dev/null
