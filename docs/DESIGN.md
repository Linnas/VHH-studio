# Loopline · VHH Design Studio
## 产品设计方案 v0.1（MVP）

> **一句话**：把「针对抗原表位的 VHH 从头设计」做成一个像剪视频一样的时间线工作台——模型是素材，片段是计算，播放头是当前设计状态，监视器里实时看到结构、序列和工作流本身。

---

## 1. 为什么是「剪辑软件」

蛋白设计流程和视频剪辑在结构上高度同构：

| 视频剪辑 | VHH 设计 | 本项目中的映射 |
| --- | --- | --- |
| 素材箱 | 模型、PDB、表位注释、评分器 | 左侧 Resource Library |
| 轨道（V1/V2/A1） | 设计阶段（靶点→表位→骨架→序列→验证→交付） | Timeline Tracks |
| 片段（Clip） | 一次模型调用（带参数与算力预算） | 可拖拽/裁剪的 Clip |
| 播放头 | 当前已"渲染"到的设计状态 | Playhead |
| 监看器 | 结构 / 序列 / 工作流 | Canvas Monitor（3D / Flow / Sequence） |
| 渲染队列 | 运行整条 pipeline | Render / Play |
| 工程文件 | 可复现的实验记录 | `.loopline.json` + provenance |
| 导出成片 | FASTA / PDB / 指标 CSV / 报告 | Deliver 节点 |

这个隐喻不是皮肤，而是**交互模型**：用户不需要先学节点图的连线规则，只要按时间顺序把模型"摆"到轨道上；系统根据片段的时间顺序和声明的输入/输出类型自动编译为 DAG。需要精细控制时，再在检查器里改参数、看自动接线。

**Tamarind Bio 的启发**：把异构的 GPU 模型包装成统一作业接口；本项目的差异点是**时间线/渲染式编排 + 表位优先的 VHH 语义**，并且把"当前设计状态"作为可 scrubbing 的一等公民。

---

## 2. 核心用户旅程

1. **载入靶点**：选择 demo 靶点（EGFR-D3 / PD-L1 / HER2）或输入 PDB ID。靶点表面在监视器中出现。
2. **圈定表位**：Epitope Scan 片段计算可及表面，给出热点残基与 patch 面积；检查器可改 hotspot 列表。
3. **生成骨架**：把 RFdiffusion 或 PROTEINA 片段拖到 Backbone 轨。骨架以 diffusion 动画逐步"凝实"，CDR 环以颜色区分。
4. **设计序列**：ProteinMPNN / AntiFold 片段生成多条 CDR 序列；候选在 Results 面板排序。
5. **验证与打分**：ESMFold / Boltz 回折，DockQ / ipSAE 打分，NanoFilter 评估人源化与聚集风险。
6. **交付**：Deliver 片段汇总 FASTA、PDB、metrics.csv 与完整 provenance。
7. **迭代**：拖动片段改变顺序、删除、复制、改参数；任何修改使下游缓存失效，时间线进入待渲染状态。空格播放，像审片一样审视设计过程。

---

## 3. 信息架构

```
┌──────────────────────────────────────────────────────────────────────┐
│ Topbar  logo · project · runtime badge · validation · Export · Render │
├──────────────┬───────────────────────────────────────┬───────────────┤
│ Resource     │  Monitor                              │ Inspector     │
│ Library      │   [3D Preview] [Flow Map] [Sequence]  │  Clip params  │
│              │                                       │  Auto-wiring  │
│ Models       │        canvas (structure)             │  Pipeline     │
│ Templates    │                                       │  check        │
│              │  legend · timecode · view controls    │  Results      │
├──────────────┴───────────────────────────────────────┴───────────────┤
│ Transport · timecode · snap · zoom        [Logs] [Fit]               │
│ ruler  0s     2s     4s     6s     8s    10s    12s    14s    16s    │
│ TARGET   ▐ Target Intake ▌                                            │
│ EPITOPE      ▐ Epitope Scan ▌                                         │
│ BACKBONE          ▐ RFdiffusion ▌                                     │
│ SEQUENCE                  ▐ ProteinMPNN ▌                             │
│ VALIDATE                         ▐ ESMFold ▌  ▐ DockQ ▌               │
│ DELIVER                                        ▐ Deliver ▌            │
└──────────────────────────────────────────────────────────────────────┘
```

### 设计语言
- 深色"调色台"底色（#07090c），面板分层用 1px 冷灰描边，不用重阴影。
- 强调色：酸橙绿 `#c8ff4d`（播放/渲染）、青 `#58e6ff`（序列/结构）、琥珀 `#ffb454`（表位）、粉 `#ff6fae`（CDR3）。
- 模型片段使用各自能力色；片段内部带微型信号纹理，像音频波形。
- 时间码、分数、残基编号用等宽字体，强调"工程仪器"感。
- 监视器保留大量负空间，结构是唯一主角；叠加层信息克制。

---

## 4. 引擎架构

```
Project JSON
   │
   ▼
Compiler ── 类型检查 / 自动接线 / 时间顺序 → DAG + 诊断
   │
   ▼
Scheduler (playhead driven, NLE render model)
   │  clip start/end, cache key = hash(params, upstream keys, seed)
   ▼
Adapter Registry
   ├── LocalSimAdapter   (MVP：确定性模拟，所有产物标注 SIM)
   ├── TamarindAdapter   (Tamarind Bio job API)
   ├── LocalGPUAdapter   (RFdiffusion / ProteinMPNN / ESMFold 本地权重)
   └── CustomHTTPAdapter (任意模型服务)
   │
   ▼
Artifacts (immutable, content-addressed)
   ├── target.surface
   ├── epitope.selection
   ├── backbone.structure
   ├── sequence.designs
   ├── complex.metrics
   └── deliverable.bundle
```

### 4.1 片段即计算
每个模型声明：

```ts
interface ModelSpec {
  id: string
  kind: 'target' | 'epitope' | 'backbone' | 'sequence' | 'structure' | 'score' | 'deliver'
  track: TrackId
  inputs: ArtifactType[]     // 自动接线的依据
  output: ArtifactType
  params: ParamSpec[]        // 检查器自动生成表单
  defaults: Record<string, unknown>
  cost: { gpu: string; seconds: number }
  adapter: 'sim' | 'tamarind' | 'local'
}
```

**自动接线规则**：对片段 `c` 的每个输入类型 `t`，选择"在 `c` 开始之前开始、且输出 `t` 的最近片段"；若没有，检查项目种子资产（target），否则报错。时间线重叠时给出 warning，但不阻止（允许并行探索）。同一轨道禁止片段重叠（拖拽时自动吸附/推挤）。

### 4.2 缓存与失效
`artifactKey = sha1(modelId + params + seed + upstreamKeys)`。修改任何参数会改变 key，下游全部失效。MVP 采用简单的"全清空 + 重新计算"，接口保留内容寻址缓存，便于后续接 Redis/S3。

### 4.3 播放头语义
- **Scrubbing 不触发计算**：只显示已完成片段（时间 ≤ 播放头）的产物。
- **Play 跨越片段末尾**时触发该片段计算（同步模拟，真实适配器为异步作业），产物进入缓存。
- **Render**：播放头归零 → 2× 速度播放 → 完成后切到 Results。
- 时间线长度是"算力预算"的可视化：片段越长代表分配的生成/采样预算越大（RFdiffusion steps、MPNN samples 与 duration 联动可后续实现）。

### 4.4 真实模型接入
MVP 的仿真适配器输出**确定性伪结构**与**模拟指标**，UI 全局标注 `SIMULATION`，绝不冒充真实预测。接真实模型只需实现：

```ts
interface Adapter {
  submit(clip, inputs, ctx): Promise<JobHandle>
  poll(handle): Promise<{ progress, logs }>
  fetch(handle): Promise<Artifact>
  cancel(handle): Promise<void>
}
```

Tamarind Bio：`POST /api/v1/jobs` 提交 RFdiffusion/ProteinMPNN/ESMFold，轮询 job 状态，下载 PDB/FASTA，映射为 Artifact。密钥放服务端，前端只持有短期 token。

---

## 5. 数据模型（节选）

```json
{
  "schema": "loopline.project/1",
  "name": "EGFR-D3 · de novo VHH",
  "seed": 20261112,
  "target": { "name": "EGFR domain III", "source": "demo", "hotspots": ["R353", "S356", "D355", "K357"] },
  "tracks": ["target", "epitope", "backbone", "sequence", "validate", "deliver"],
  "clips": [
    {
      "id": "clp_rfd_01",
      "modelId": "rfdiffusion",
      "track": "backbone",
      "start": 4.5,
      "duration": 4.0,
      "params": { "hotspots": "R353,S356,D355,K357", "length": 118, "steps": 50, "noise": 0.5 }
    }
  ],
  "playhead": 0
}
```

---

## 6. MVP 范围（本次交付）

**做**
- 时间线：拖入模型、横向移动、跨轨移动、右边缘裁剪、吸附、缩放、播放头 scrub、删除/复制、撤销重做。
- 6 条轨道、11 个模型 / 工具资源、3 套模板。
- 编译器：类型检查、自动接线、错误/警告、运行前诊断。
- 播放/渲染：播放头驱动、逐片段计算、进度、日志、结果。
- 监视器：可旋转缩放的结构视图（抗原表面 + 表位 + VHH 骨架 + 3 个 CDR 环）、Flow Map 工作流视图、Sequence 视图。
- 检查器：按模型 schema 动态生成参数表单、自动接线展示、项目设置。
- 结果：候选排序表、指标、选中候选同步序列视图。
- 导出：工程 JSON、FASTA、PDB（CA trace）、metrics CSV。
- 本地持久化、全局 SIM 标识。

**不做（下一阶段）**
- 真实 GPU 推理与排队（适配器接口已留）。
- 多链/多聚体、非蛋白配体、纳米抗体种属人源化真值。
- 协作、版本分支、湿实验数据回流。
- 真实物理能量计算；所有数值均为演示。

---

## 7. 路线图

- **v0.2**：Tamarind Bio 适配器、真实 PDB 解析（mmCIF）、作业队列与取消、服务端密钥代理。
- **v0.3**：并行轨道与 A/B 对照、片段组（Compound Clip）、渲染农场、结果版本对比。
- **v0.4**：表位热图编辑器（在 3D 表面刷选 hotspot）、CDR 序列锁定、湿实验反馈闭环。
- **v1.0**：团队资源库、审计与 provenance、ELN/LIMS 导出、合规。

---

## 8. MVP 落地状态（v0.1）

本仓库已实现可交互的 MVP，零运行时依赖，`npm start` 即可打开：

- **时间线编辑器**：拖入、跨轨移动、右缘裁剪、吸附、缩放、scrub、删除、复制、撤销重做、同轨避让。
- **编译器**：按开始时间自动接线，缺输入 / 上游未完成 / 同轨重叠 / 越界均有诊断。
- **运行时**：播放头驱动的 artifact 计算，缓存失效，逐片段日志，2× Render，完成自动切 Results。
- **监视器**：Canvas 2D 自绘的 3D 示意（抗原表面点云 + 表位 + β-sandwich VHH + CDR 环 + 接触线 + diffusion 粒子）、Flow Map（带自动接线边）、Sequence（残基着色 + CDR 注释 + 三张 dossier 卡）。
- **资源**：11 个模型 / 工具、6 条轨道、3 套模板（EGFR-D3、PD-L1、HER2）。
- **交付**：项目 JSON、FASTA、PDB（CA trace + REMARK）、metrics CSV。
- **验证**：`npm test` 10 个测试覆盖编译、模板、确定性、阶段状态、指标范围、导出器与模型契约；`tools/cdp.mjs` 提供 headless Chrome 截图与交互 smoke test。

**明确边界**：当前 `Engine` 使用确定性模拟；结构是程序化示意，指标为模拟值，UI 与导出文件均标注 `SIMULATION`。真实 RFdiffusion / PROTEINA / ProteinMPNN / ESMFold / Boltz / Tamarind 接口尚未接入，但 artifact 契约与 adapter 扩展点已保留。

### 代码地图

```
src/engine/models.js   模型目录、轨道、模板、项目工厂
src/engine/compiler.js 时间线 → typed DAG + 诊断
src/engine/runtime.js  播放头驱动运行时 + artifact 缓存
src/engine/structure.js 程序化几何、设计序列、PDB/FASTA/CSV
src/state.js           项目状态、历史、持久化、Render、导出
src/ui/timeline.js     NLE 交互
src/ui/monitor.js      3D / Flow / Sequence 三种 Canvas 视图
src/ui/inspector.js    参数表单、接线、诊断、Results
```

