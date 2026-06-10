from denoland/deno:2.8.2

# renovate: datasource=github-releases depName=pkl packageName=apple/pkl
env PKL_VERSION=0.31.0

# git clones the cluster repo at a tag; pkl packages it (see build.ts).
run <<-EOF
    apt-get update
    apt-get install -y --no-install-recommends git ca-certificates curl
    curl -L -o /usr/local/bin/pkl "https://github.com/apple/pkl/releases/download/${PKL_VERSION}/pkl-linux-amd64"
    chmod +x /usr/local/bin/pkl
    pkl --version
    apt-get purge -y curl
    apt-get autoremove -y
    rm -rf /var/lib/apt/lists/*
EOF

workdir /app
copy . .
run deno cache main.ts
expose 8000
cmd ["run", "-A", "main.ts"]
