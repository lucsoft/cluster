{{- $v114 := semverCompare ">= 1.14.0-0" (default (trimPrefix "v" .TalosVersion) .Node.RuntimeData.TalosVersion) }}
{{- if $v114 }}
apiVersion: v1alpha1
kind: KubeletConfig
config:
  memorySwap:
    swapBehavior: LimitedSwap
{{- else }}
machine:
  kubelet:
    extraConfig:
      memorySwap:
        swapBehavior: LimitedSwap
{{- end }}
