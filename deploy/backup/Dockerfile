# syntax=docker/dockerfile:1

# The base is the same PostgreSQL major as the stack server so pg_dump and
# pg_restore are major-version compatible. The image is currently based on
# Debian trixie, where the restic package is 0.18.0. The entrypoint prints and
# asserts the pg_dump/server major versions at runtime.
FROM postgres:16

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        restic \
        jq \
        curl \
        ca-certificates \
        openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Reuse uid/gid 1001 because the API writes media as 1001:1001 with directories
# 0750 and files 0600. A different uid could not read the read-only media mount.
# The Debian base already has a "backup" user at uid/gid 34, so use a distinct
# name with the media uid/gid.
RUN groupadd --system --gid 1001 zaynbackup \
    && useradd --system --uid 1001 --gid zaynbackup \
        --home-dir /home/zaynbackup --shell /usr/sbin/nologin zaynbackup \
    && mkdir -p /home/zaynbackup /scratch /status /repo /restore-target /data/media \
    && chown -R zaynbackup:zaynbackup \
        /home/zaynbackup /scratch /status /repo /restore-target /data/media

ENV HOME=/home/zaynbackup \
    RESTIC_CACHE_DIR=/scratch/restic-cache \
    TMPDIR=/scratch/tmp

COPY --chown=zaynbackup:zaynbackup deploy/backup/entrypoint.sh /usr/local/bin/zayn-backup
COPY --chown=zaynbackup:zaynbackup apps/api/db-bootstrap/0000_roles.sql \
    /usr/local/share/zayn/db-bootstrap/0000_roles.sql

RUN sed -i 's/\r$//' /usr/local/bin/zayn-backup \
    && chmod 0755 /usr/local/bin/zayn-backup

USER zaynbackup

ENTRYPOINT ["/usr/local/bin/zayn-backup"]
CMD ["backup"]
