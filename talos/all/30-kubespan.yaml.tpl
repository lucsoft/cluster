{{- /* Autoscaled workers get no hcloud private network; KubeSpan wraps node-to-node traffic in WireGuard. */}}
{{- $v114 := semverCompare ">= 1.14.0-0" (default (trimPrefix "v" .TalosVersion) .Node.RuntimeData.TalosVersion) }}
{{- if $v114 }}
apiVersion: v1alpha1
kind: KubeSpanConfig
enabled: true
{{- else }}
machine:
  network:
    kubespan:
      enabled: true
cluster:
  discovery:
    enabled: true
{{- end }}
