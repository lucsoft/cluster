# Fission environment that runs function TS/JS on Andromeda.
# Deno stays in the runtime image on purpose: invoking shells out to the andromeda binary.
# Upstream publishes no linux/arm64 build, so this image is amd64-only.
from denoland/deno:2.8.2

# renovate: datasource=github-releases depName=andromeda packageName=tryandromeda/andromeda
env ANDROMEDA_VERSION=0.1.14

run <<-EOF
    set -eu
    apt-get update
    apt-get install -y --no-install-recommends ca-certificates curl
    curl -fsSL -o /usr/local/bin/andromeda \
      "https://github.com/tryandromeda/andromeda/releases/download/${ANDROMEDA_VERSION}/andromeda-linux-amd64"
    chmod +x /usr/local/bin/andromeda
    andromeda --help > /dev/null
    apt-get purge -y curl
    apt-get autoremove -y
    rm -rf /var/lib/apt/lists/*
EOF

workdir /app
copy main.ts .
run deno cache main.ts
expose 8888
cmd ["run", "-A", "main.ts"]
