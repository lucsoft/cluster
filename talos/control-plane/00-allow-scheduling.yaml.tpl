{{- /* The CP is also the only always-on worker, so it must take pods and stay a load balancer target. */}}
{{- $v114 := semverCompare ">= 1.14.0-0" (default (trimPrefix "v" .TalosVersion) .Node.RuntimeData.TalosVersion) }}
{{- if $v114 }}
apiVersion: v1alpha1
kind: KubeNodeConfig
labels:
  node.kubernetes.io/exclude-from-external-load-balancers:
    $patch: delete
taints:
  node-role.kubernetes.io/control-plane:
    $patch: delete
{{- else }}
machine:
  nodeLabels:
    node.kubernetes.io/exclude-from-external-load-balancers:
      $patch: delete
cluster:
  allowSchedulingOnControlPlanes: true
{{- end }}
