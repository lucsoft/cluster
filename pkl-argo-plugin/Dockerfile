from alpine

copy plugin.yaml /home/argocd/cmp-server/config/plugin.yaml

run <<-EOF
    apk add --no-cache curl gcompat
    curl -L -o pkl 'https://github.com/apple/pkl/releases/download/0.30.0/pkl-linux-amd64'
    chmod +x pkl
    mv pkl /usr/local/bin/
    apk del --no-cache curl
    rm -rf /var/log/apk.log /lib/apk/db/
EOF

run pkl --version

entrypoint ["/var/run/argocd/argocd-cmp-server"]