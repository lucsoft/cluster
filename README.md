# Personal Kubernetes Cluster

Welcome to my personal Kubernetes cluster repository!
This project uses [Pkl](https://pkl-lang.org/) for configuration management, enabling modular, type-safe, and maintainable infrastructure code.

## Structure

- **/personal-cluster**: Main cluster configuration and secrets.
- **/packages**: Reusable Pkl packages for various workloads and tools.

## Packages

The following Pkl packages are available under `/packages`:

- **argo.ArgoCD**
    Pkl configuration for deploying and managing ArgoCD.

- **itzg.minecraft**
    Pkl configuration for running Minecraft server workloads.

- **lucsoft.k8s.Workload**
    Generic Pkl package for Kubernetes workloads.

## Getting Started

1. Clone this repository.
2. Install [Pkl](https://pkl-lang.org/main/current/index.html).
3. Explore the `personal-cluster` directory for cluster setup.
4. Use the packages in `/packages` to compose and manage your workloads.

---

Feel free to explore and adapt the configurations for your own use!