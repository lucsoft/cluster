# Fission environment that AOT-compiles function JS to a native binary with Porffor.
# Deno stays in the runtime image on purpose: specialize shells out to porf, which
# shells out to cc, so neither a distroless nor a scratch base would work.
from denoland/deno:2.8.2

arg TARGETARCH
# renovate: datasource=github-releases depName=porffor packageName=CanadaHonk/porffor
env PORFFOR_VERSION=alpha-1

# porffor defaults to `cc`; name gcc explicitly so it never depends on the alternatives link.
env CC=gcc

run <<-EOF
    set -eu
    apt-get update
    apt-get install -y --no-install-recommends ca-certificates curl gcc libc6-dev
    # Porffor names the x86_64 asset "x64", so TARGETARCH can't go straight into the URL.
    case "${TARGETARCH}" in
      amd64) curl -fsSL "https://github.com/CanadaHonk/porffor/releases/download/${PORFFOR_VERSION}/porffor-linux-x64.tar.gz" | tar -xz -C /usr/local/bin porf ;;
      arm64) curl -fsSL "https://github.com/CanadaHonk/porffor/releases/download/${PORFFOR_VERSION}/porffor-linux-arm64.tar.gz" | tar -xz -C /usr/local/bin porf ;;
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;;
    esac
    chmod +x /usr/local/bin/porf
    porf --version
    apt-get purge -y curl
    apt-get autoremove -y
    rm -rf /var/lib/apt/lists/*
EOF

workdir /app
copy main.ts .
run deno cache main.ts
expose 8888
cmd ["run", "-A", "main.ts"]
