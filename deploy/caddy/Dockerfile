ARG CADDY_IMAGE=caddy:2-alpine
FROM ${CADDY_IMAGE}
# Runtime drops every capability; privileged ports use the existing namespace
# sysctl. Remove a base-image file capability before executing as the app user.
# Checked assignments also reject getcap failures, including empty error output.
RUN caddy_capabilities="$(getcap /usr/bin/caddy)" \
    && if [ -n "$caddy_capabilities" ]; then setcap -r /usr/bin/caddy; fi \
    && caddy_capabilities="$(getcap /usr/bin/caddy)" \
    && [ -z "$caddy_capabilities" ] \
    && addgroup -S -g 10002 idealmakoo \
    && adduser -S -D -H -u 10002 -G idealmakoo idealmakoo \
    && mkdir -p /data/caddy /config/caddy \
    && chown -R 10002:10002 /data /config
COPY --chown=10002:10002 --chmod=0444 Caddyfile /etc/caddy/Caddyfile
USER 10002:10002

