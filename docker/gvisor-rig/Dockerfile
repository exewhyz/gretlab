# Docker-in-Docker with gVisor, for testing the sandbox on machines that can't install
# runsc directly, such as Docker Desktop on a Mac. TESTING ONLY: it runs privileged.
# Production installs runsc on the runner host: https://gvisor.dev/docs/user_guide/install/
FROM docker:29-dind
RUN apk add --no-cache zstd tar \
  && U=https://storage.googleapis.com/gvisor/releases/release/20261026/$(uname -m) \
  && mkdir /tmp/g && cd /tmp/g \
  && wget -q "$U/gvisor.tar.zstd" "$U/gvisor.tar.zstd.sha512" \
  && sha512sum -c gvisor.tar.zstd.sha512 \
  && tar --zstd -xf gvisor.tar.zstd -C /usr/local/bin \
  && rm -rf /tmp/g
COPY daemon.json /etc/docker/daemon.json
