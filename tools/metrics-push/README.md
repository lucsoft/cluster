# metrics-push

Pushes node-exporter metrics from a host with no inbound route into VictoriaMetrics, via the
vmauth endpoint that `personal-cluster/components/VmPush.pkl` exposes.

Built for the GL-X3000 (aarch64 OpenWrt). One long-lived process rather than a cron job, for
two reasons: OpenWrt's crond floors at one-minute resolution, which is too coarse for
interface counters, and a daemon establishes the outbound TLS connection once instead of
paying a handshake every tick.

## Build

Needs the cross toolchain for its musl headers — rustls' crypto provider builds C and asm
sources, so a linker alone is not enough:

```sh
brew install messense/macos-cross-toolchains/aarch64-unknown-linux-musl
```

`.cargo/config.toml` pins the target and toolchain, so a plain build produces the router
binary — 1.3 MB, statically linked, no libc or ca-certificates dependency on the device:

```sh
cargo build --release
```

## Router setup

Install the exporter and the OpenWrt-specific collectors, which cover the things plain
node-exporter does not know about:

```sh
opkg update && opkg install prometheus-node-exporter-lua prometheus-node-exporter-lua-openwrt prometheus-node-exporter-lua-nat_traffic prometheus-node-exporter-lua-wifi_stations
```

Bind it to loopback before starting it. The default listens on every interface, which puts an
unauthenticated metrics endpoint on the WAN:

```sh
uci set prometheus-node-exporter-lua.main.listen_interface='loopback'
uci commit prometheus-node-exporter-lua
/etc/init.d/prometheus-node-exporter-lua restart
```

Then deploy the pusher:

```sh
scp target/aarch64-unknown-linux-musl/release/metrics-push root@<router>:/usr/bin/metrics-push
scp openwrt/metrics-push.init root@<router>:/etc/init.d/metrics-push
scp openwrt/metrics-push.conf.example root@<router>:/etc/metrics-push.conf
```

Fill in `METRICS_PUSH_TOKEN` on the router from the sealed secret:

```sh
sops decrypt personal-cluster/secrets/vm-push-auth.sops.yaml | grep glinet-token
```

Then lock the config down and start it:

```sh
chmod 600 /etc/metrics-push.conf && chmod +x /etc/init.d/metrics-push && /etc/init.d/metrics-push enable && /etc/init.d/metrics-push start
```

Per-tick failures are logged and never fatal, so a router that loses its uplink keeps
retrying. Watch them with `logread -f -e metrics-push`.

## Verifying

Samples arrive with `instance` and `job` applied from the push URL, so query for them
directly. From the cluster:

```sh
kubectl -n monitoring exec deploy/vmsingle-monitoring-victoria-metrics-k8s-stack -- wget -qO- 'http://localhost:8428/api/v1/query?query=up%7Binstance%3D%22glinet%3A9100%22%7D'
```

A dead router produces no samples rather than stale ones, so alert on absence:
`absent_over_time(node_time_seconds{instance="glinet:9100"}[5m])`.
