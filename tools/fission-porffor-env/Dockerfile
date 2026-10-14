# porffor binary (fetched on the builder's own arch, copied into the runtime below)
# Porffor ships a bun-compiled single binary, which segfaults under qemu — so this stage
# must never run it, and cross-builds can only verify it in the target-arch runtime.
from --platform=$BUILDPLATFORM alpine:3.23.3 as porffor
arg TARGETARCH
# renovate: datasource=github-releases depName=porffor packageName=CanadaHonk/porffor
env PORFFOR_VERSION=alpha-1
run <<-EOF
    set -eu
    apk add --no-cache curl
    # Porffor names the x86_64 asset "x64", so TARGETARCH can't go straight into the URL.
    case "${TARGETARCH}" in
      amd64) curl -fsSL "https://github.com/CanadaHonk/porffor/releases/download/${PORFFOR_VERSION}/porffor-linux-x64.tar.gz" | tar -xz -C / porf ;;
      arm64) curl -fsSL "https://github.com/CanadaHonk/porffor/releases/download/${PORFFOR_VERSION}/porffor-linux-arm64.tar.gz" | tar -xz -C / porf ;;
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;;
    esac
    chmod +x /porf
EOF

# Fission environment that AOT-compiles function JS to a native binary with Porffor.
# Deno stays in the runtime image on purpose: specialize shells out to porf, which
# shells out to cc, so neither a distroless nor a scratch base would work.
from denoland/deno:2.9.6

# porffor defaults to `cc`; name gcc explicitly so it never depends on the alternatives link.
env CC=gcc

run <<-EOF
    set -eu
    apt-get update
    apt-get install -y --no-install-recommends gcc libc6-dev
    rm -rf /var/lib/apt/lists/*
EOF

copy --from=porffor /porf /usr/local/bin/porf

workdir /app
copy main.ts .
run deno cache main.ts
expose 8888
cmd ["run", "-A", "main.ts"]
