{{- /* Live Talos version picks the config contract; offline renders fall back to talosVersion. */}}
{{- $v114 := semverCompare ">= 1.14.0-0" (default (trimPrefix "v" .TalosVersion) .Node.RuntimeData.TalosVersion) }}
{{- with get .Node.Data "nodeLabels" }}
{{- if $v114 }}
apiVersion: v1alpha1
kind: KubeNodeConfig
labels:
{{- else }}
machine:
  nodeLabels:
{{- end }}
  {{- range $key, $value := . }}
    {{ $key }}: {{ $value | toJson }}
  {{- end }}
{{- end }}
