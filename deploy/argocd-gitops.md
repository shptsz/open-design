# Open Design ArgoCD GitOps 发布说明

## 背景

当前 Kubernetes 集群部署在内网，阿里云云效流水线无法直接访问集群 API Server。集群内已经安装 ArgoCD，并且已有部分服务通过 ArgoCD 运行。

因此 Open Design 推荐采用 GitOps 发布方式：

- 云效只负责构建镜像并推送到 ACR。
- 云效不直接连接内网 Kubernetes。
- 云效更新 tools 统一部署仓库中的 Open Design 镜像版本。
- ArgoCD 在内网集群中监听部署仓库变更，并同步到 Kubernetes。

## 仓库定位

已有的部署仓库作为 tools 工具类服务的统一 GitOps 仓库使用。当前仅接入 Open Design，后续其他工具服务也可以按相同方式接入。

建议仓库职责：

- 保存 tools 服务的 Kubernetes/Helm/Kustomize 部署配置。
- 每个工具服务独立目录、独立 namespace、独立 ArgoCD Application。
- 云效流水线只修改对应服务目录下的镜像 tag，不直接操作集群。

推荐目录结构：

```text
tools-gitops-repo/
  apps/
    open-design/
      namespace.yaml
      deployment.yaml
      service.yaml
      ingress.yaml
      kustomization.yaml
  argocd/
    applications/
      open-design.yaml
```

说明：

- `apps/open-design/` 保存 Open Design 的 Kubernetes 资源。
- `argocd/applications/open-design.yaml` 保存 ArgoCD Application 配置。
- 后续新增工具时，新增 `apps/<tool-name>/` 和 `argocd/applications/<tool-name>.yaml`，不要和 Open Design 资源混放。

## 发布链路

```text
开发提交代码
  -> 云效流水线构建 Open Design 镜像
  -> 推送镜像到 ACR
  -> 云效更新 tools-gitops-repo/apps/open-design/ 中的 image tag
  -> git push 到部署仓库
  -> ArgoCD 发现 Git 变更
  -> ArgoCD 同步到内网 Kubernetes
  -> Open Design 滚动发布
```

这个链路中，云效不需要访问内网 Kubernetes。只需要具备：

- 访问代码仓库的权限。
- 推送镜像到 ACR 的权限。
- 更新 tools GitOps 部署仓库的权限。

ArgoCD 需要具备：

- 从 tools GitOps 部署仓库拉取配置的权限。
- 在目标 namespace 创建或更新 Kubernetes 资源的权限。
- 集群节点能够拉取 ACR 中的 Open Design 镜像。

## ArgoCD Application 示例

根据实际 Git 仓库地址、分支和 namespace 调整：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: open-design
  namespace: argocd
spec:
  project: default
  source:
    repoURL: git@github.com:your-org/tools-gitops-repo.git
    targetRevision: main
    path: apps/open-design
  destination:
    server: https://kubernetes.default.svc
    namespace: open-design
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

如果你们已有 ArgoCD App of Apps 模式，可以把 `argocd/applications/open-design.yaml` 纳入现有 root Application 管理；否则可以先手动 apply 这个 Application。

## Open Design Kubernetes 资源示例

`apps/open-design/kustomization.yaml`：

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
  - deployment.yaml
  - service.yaml
  # - pvc.yaml          # 多 Agent / 需持久化鉴权与数据时启用，见文末章节
  # - ingress.yaml
```

`apps/open-design/namespace.yaml`：

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: open-design
```

`apps/open-design/deployment.yaml`：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: open-design
  namespace: open-design
spec:
  replicas: 1
  selector:
    matchLabels:
      app: open-design
  template:
    metadata:
      labels:
        app: open-design
    spec:
      imagePullSecrets:
        - name: acr-pull-secret
      containers:
        - name: open-design
          image: crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/open-design:0.10.0
          ports:
            - name: http
              containerPort: 7456
          env:
            - name: OD_BIND_HOST
              value: "0.0.0.0"
            - name: OD_PORT
              value: "7456"
            - name: OD_API_TOKEN
              valueFrom:
                secretKeyRef:
                  name: open-design-secret
                  key: OD_API_TOKEN
```

`apps/open-design/service.yaml`：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: open-design
  namespace: open-design
spec:
  type: ClusterIP
  selector:
    app: open-design
  ports:
    - name: http
      port: 7456
      targetPort: http
```

如需域名访问，可以在 `apps/open-design/ingress.yaml` 中根据你们集群的 Ingress Controller 规范配置。

## 密钥与镜像拉取

不要把真实密钥明文提交到 GitOps 仓库。以下内容建议由集群侧预先创建，或使用 SealedSecret、ExternalSecret 等方案管理：

- `OD_API_TOKEN`
- ACR 拉取镜像凭据
- OpenCode / 大模型供应商 token

示例，仅用于说明资源名称关系：

```bash
kubectl -n open-design create secret generic open-design-secret \
  --from-literal=OD_API_TOKEN='<replace-with-real-token>'

kubectl -n open-design create secret docker-registry acr-pull-secret \
  --docker-server=crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com \
  --docker-username='<acr-username>' \
  --docker-password='<acr-password>'
```

## 云效流水线发布步骤

构建镜像并推送到 ACR 后，新增一个更新 GitOps 仓库的步骤。该步骤只需要访问 Git，不需要访问 Kubernetes。

示例：

```bash
set -euo pipefail

IMAGE_TAG="${OPEN_DESIGN_VERSION}-${CI_COMMIT_SHORT_SHA}"
IMAGE="crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/open-design:${IMAGE_TAG}"

git clone git@github.com:your-org/tools-gitops-repo.git
cd tools-gitops-repo

yq -i '.spec.template.spec.containers[] |=
  (select(.name == "open-design").image = strenv(IMAGE))' \
  apps/open-design/deployment.yaml

git config user.name "yunxiao-ci"
git config user.email "yunxiao-ci@example.com"

git add apps/open-design/deployment.yaml
git commit -m "deploy: open-design ${IMAGE_TAG}"
git push origin main
```

如果你们使用 Kustomize 的 `images` 字段，也可以让云效只改 `kustomization.yaml`：

```yaml
images:
  - name: crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/open-design
    newTag: 0.10.0
```

## 推荐落地顺序

1. 在 tools GitOps 仓库中创建 `apps/open-design/`。
2. 添加 Open Design 的 `namespace.yaml`、`deployment.yaml`、`service.yaml`、`kustomization.yaml`。
3. 在 `argocd/applications/open-design.yaml` 中创建独立 ArgoCD Application。
4. 在集群中准备 `open-design-secret` 和 `acr-pull-secret`。
5. 先通过 ArgoCD 手动 Sync 验证 Open Design 能正常启动。
6. 云效流水线增加“更新 GitOps 仓库 image tag”的步骤。
7. 开启 ArgoCD 自动同步，或保留人工 Sync 作为发布审批点。

## 多 Agent 部署（OpenCode + Cursor CLI）与配置挂载简化

如果使用 `deploy/Dockerfile.agents` 构建的镜像（同时内置 OpenCode 与 Cursor
CLI，用户在界面里二选一），k8s 侧需要挂载两类配置：OpenCode 的
`opencode.json`（含本地模型 baseURL/apiKey）和 Cursor 的 `CURSOR_API_KEY`。

不要拆成多个 ConfigMap/Secret。`opencode.json` 本身含 apiKey 属于敏感数据，
把三项收敛进**一个 Secret**，是最简单也最安全的做法：

```bash
kubectl -n open-design create secret generic open-design-secret \
  --from-literal=OD_API_TOKEN='<replace-with-real-token>' \
  --from-literal=CURSOR_API_KEY='<cursor-user-or-service-account-api-key>' \
  --from-file=opencode.json=./opencode.json
```

`opencode.json` 用集群外的 `deploy/opencode/opencode.qwen36.example.json` 复制
改好后作为 `--from-file` 传入，不进 Git 仓库。

Deployment 里同时用 env 注入两个 key、用 secret 卷把 `opencode.json` 投影成
文件，并补上数据持久化 PVC（否则 `/app/.od` 下的 HOME、OpenCode/Cursor 鉴权
缓存、daemon 数据每次重启都会丢失）：

`apps/open-design/deployment.yaml`（多 Agent 版关键片段）：

```yaml
spec:
  template:
    spec:
      imagePullSecrets:
        - name: acr-pull-secret
      securityContext:
        runAsNonRoot: true
        runAsUser: 1001
        runAsGroup: 1001
        fsGroup: 1001
      containers:
        - name: open-design
          image: crpi-sxza8grrzyp8e6zm.cn-shanghai.personal.cr.aliyuncs.com/shpt/open-design:agents-0.10.0
          ports:
            - name: http
              containerPort: 7456
          securityContext:
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
          env:
            - name: OD_BIND_HOST
              value: "0.0.0.0"
            - name: OD_PORT
              value: "7456"
            # 私有部署：关闭遥测与自动更新
            - name: OPEN_DESIGN_PRIVATE_DEPLOYMENT
              value: "1"
            - name: OD_UPDATE_ENABLED
              value: "0"
            # OpenCode/Cursor 鉴权缓存写到持久化卷
            - name: HOME
              value: /app/.od/home
            - name: OPENCODE_CONFIG
              value: /app/opencode/opencode.json
            # 默认 agent（改成 cursor-agent 即默认 Cursor，两者都仍可选）
            - name: OPEN_DESIGN_DEFAULT_AGENT_ID
              value: "opencode"
            - name: OD_API_TOKEN
              valueFrom:
                secretKeyRef:
                  name: open-design-secret
                  key: OD_API_TOKEN
            - name: CURSOR_API_KEY
              valueFrom:
                secretKeyRef:
                  name: open-design-secret
                  key: CURSOR_API_KEY
          volumeMounts:
            - name: opencode-config
              mountPath: /app/opencode
              readOnly: true
            - name: data
              mountPath: /app/.od
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: opencode-config
          secret:
            secretName: open-design-secret
            items:
              - key: opencode.json
                path: opencode.json
        - name: data
          persistentVolumeClaim:
            claimName: open-design-data
        - name: tmp
          emptyDir: {}
```

`apps/open-design/pvc.yaml`（记得加进 `kustomization.yaml` 的 `resources`）：

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: open-design-data
  namespace: open-design
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
```

> Cursor CLI 不是离线的：`cursor-agent` 会连 `api2.cursor.sh`。若集群对 Pod 出网
> 有 NetworkPolicy 限制，需放行 `cursor.com` / `api2.cursor.sh`。OpenCode 仍只连
> 你配置的本地模型。

## k8s 部署后的初始化（目标：0 手动步骤）

“部署后还要手动跑命令”几乎只来自密钥。把它们也纳入 GitOps 即可消除：

- **推荐（0 手动步骤）**：集群侧一次性安装 `sealed-secrets` controller 后，用
  `kubeseal` 把上面的 `open-design-secret`（含 `opencode.json` 与
  `CURSOR_API_KEY`）封装成 `SealedSecret` 提交到 GitOps 仓库。ArgoCD 同步时自动
  解封，PVC 也由 git 中的 `pvc.yaml` 创建。此后发布全程无需 `kubectl`。

  ```bash
  kubectl -n open-design create secret generic open-design-secret \
    --from-literal=OD_API_TOKEN='<token>' \
    --from-literal=CURSOR_API_KEY='<cursor-key>' \
    --from-file=opencode.json=./opencode.json \
    --dry-run=client -o yaml \
    | kubeseal --format yaml > apps/open-design/sealed-secret.yaml
  # 提交 sealed-secret.yaml 到 GitOps 仓库即可，明文不入库。
  ```

- **替代（ExternalSecret）**：密钥放外部 Vault/KMS，集群侧 External Secrets
  Operator 拉取生成同名 Secret，GitOps 仓库只存引用。

- **最小手动方案（不引入额外组件时）**：仅需两条一次性命令，且与发布解耦——
  1. `acr-pull-secret`（镜像拉取凭据，见上文「密钥与镜像拉取」）。
  2. 上面的 `open-design-secret`（合并后的单个 Secret）。

  之后日常发布只改 image tag，不再碰这些初始化。

## 后续扩展约定

后续所有 tools 服务按照相同规则接入：

- 每个工具一个 `apps/<tool-name>/` 目录。
- 每个工具一个独立 ArgoCD Application。
- 每个工具独立 namespace 和 Secret。
- 云效只更新对应工具的 image tag。
- 不同工具之间不要共用 Deployment、Service 或 Secret。
