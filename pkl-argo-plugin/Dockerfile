from alpine:3.23.3

copy plugin.yaml /home/argocd/cmp-server/config/plugin.yaml

# renovate: datasource=github-releases depName=pkl packageName=apple/pkl
env PKL_VERSION=0.31.0

run <<-EOF
    apk add --no-cache curl gcompat
    curl -L -o pkl "https://github.com/apple/pkl/releases/download/${PKL_VERSION}/pkl-linux-amd64"
    chmod +x pkl
    mv pkl /usr/local/bin/
    apk del --no-cache curl
    rm -rf /var/log/apk.log /lib/apk/db/
EOF

run pkl --version

entrypoint ["/var/run/argocd/argocd-cmp-server"]