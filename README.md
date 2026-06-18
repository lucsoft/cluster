# Personal Kubernetes Cluster

Welcome to my personal Kubernetes cluster repository!
This project uses [Pkl](https://pkl-lang.org/) for configuration management, enabling modular, type-safe, and maintainable infrastructure code. The cluster runs on [Talos Linux](https://www.talos.dev/) nodes (Hetzner) and is deployed via [ArgoCD](https://argo-cd.readthedocs.io/) GitOps.

## Structure

- **/personal-cluster**: The live cluster config and ArgoCD source.
  - `index.pkl` — root app-of-apps that lists every child Application.
  - `apps/*.pkl` — ArgoCD `Application` definitions, each pointing at a `components/*.pkl` entrypoint.
  - `components/*.pkl` — actual workload definitions consuming the shared packages.
  - `secrets/` — sealed SopsSecrets.
- **/packages**: Reusable Pkl packages for various workloads and tools.
- **/pkl-packages**: Source for the Pkl registry hosting the packages. <https://pkl-pkgs.lucsoft.de/>
- **/pkl-argo-plugin**: ArgoCD `ConfigManagementPlugin` that renders Pkl into manifests.
- **/talos**, **/talos-test**: Talos node configuration.
- **/tools**: Deno utilities (e.g. `bootstrap-secret`, `mc-router-scaler`).

## Packages

The following Pkl packages are available under `/packages`:

- **argo.ArgoCD** — Deploying and managing ArgoCD.
- **com.SopsSecretsOperator** — SOPS-encrypted secrets management.
- **dev.Knative** — Knative serverless workloads.
- **io.CertManager** — TLS certificate management with cert-manager.
- **io.CloudNativePG** — PostgreSQL clusters via CloudNativePG.
- **io.Fission** — Fission serverless functions.
- **io.Traefik** — Traefik ingress controller.
- **io.k3s.HelmController** — Managing Helm charts via the k3s Helm controller.
- **itzg.minecraft** — Minecraft server workloads.
- **lucsoft.k8s.NetworkPolicies** — Kubernetes network policies.
- **lucsoft.k8s.Resource** — Generic Kubernetes resource helpers.
- **lucsoft.k8s.Workload** — Generic Kubernetes workloads.
- **microsoft.AzurePipelines** — Azure Pipelines agents.

Up to date list can be found in the repository <https://pkl-pkgs.lucsoft.de/>.

## Getting Started

1. Clone this repository.
2. Install [Pkl](https://pkl-lang.org/main/current/index.html).
3. Explore the `personal-cluster` directory for cluster setup.
4. Use the packages in `/packages` to compose and manage your workloads.

Render any component locally with:

```sh
pkl eval personal-cluster/components/<Component>.pkl
```

---

Feel free to explore and adapt the configurations for your own use!
