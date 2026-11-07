{{- /* topf injects the install doc itself; only the pre-1.14 `.machine.install` form needs the disk. */}}
{{- if not (semverCompare ">= 1.14.0-0" (default (trimPrefix "v" .TalosVersion) .Node.RuntimeData.TalosVersion)) }}
machine:
  install:
    disk: /dev/sda
{{- end }}
