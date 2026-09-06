from denoland/deno:2.8.2

# renovate: datasource=github-releases depName=pkl packageName=apple/pkl
env PKL_VERSION=0.32.1

# pkl renders the generated schema into a module and packages it (see build.ts).
run <<-EOF
    apt-get update
    apt-get install -y --no-install-recommends ca-certificates curl
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

# Warm the Pkl package cache so the first chart build does not have to fetch pkl-pantry.
run <<-EOF
    set -e
    mkdir -p /tmp/warmup
    printf '{"type":"object","properties":{"warm":{"type":"string"}}}' > /tmp/warmup/Values.json
    pkl eval generate.pkl -p schemaUri=file:///tmp/warmup/Values.json -p chart=warmup -p chartVersion=0.0.0 -p chartRepository=example.com -m /tmp/warmup
    rm -rf /tmp/warmup
EOF

expose 8000
cmd ["run", "-A", "main.ts"]
