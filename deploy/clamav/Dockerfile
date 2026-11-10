ARG CLAMAV_IMAGE=clamav/clamav:stable_base
FROM ${CLAMAV_IMAGE}
USER root
COPY idealmakoo-clamav.sh /usr/local/bin/idealmakoo-clamav.sh
RUN chmod 0555 /usr/local/bin/idealmakoo-clamav.sh \
    && mkdir -p /var/lib/clamav \
    && chown -R clamav:clamav /var/lib/clamav
USER clamav
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/idealmakoo-clamav.sh"]
