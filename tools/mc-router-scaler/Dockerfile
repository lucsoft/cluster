# kubectl binary (statically linked, copied into the distroless runtime below)
from alpine:3.24.0 as kubectl
arg TARGETARCH
# renovate: datasource=github-releases depName=kubectl packageName=kubernetes/kubernetes
env KUBECTL_VERSION=v1.36.1
run <<-EOF
    apk add --no-cache curl
    curl -fsSL -o /kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl"
    chmod +x /kubectl
EOF

# Cache Deno's deps in their own layer.
from denoland/deno:2.8.2 as cache
workdir /app
copy main.ts .
run deno cache main.ts

from denoland/deno:distroless-2.8.2
copy --from=kubectl /kubectl /usr/local/bin/kubectl
copy --from=cache /deno-dir /deno-dir
workdir /app
copy main.ts .
expose 8080
cmd ["run", "-A", "main.ts"]
