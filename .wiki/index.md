# Wiki Index

> 由 dsh-knj-obsidian 维护。概念页 / 实体页 / 参考 / 综合 / 项目知识。

## 概念页

- [[qmd-全局索引库的跨库噪声与两道防线]] QMD 全局索引库的跨库噪声与两道防线 — 一个 ~/.dsh/qmd/index.sqlite 同时装多个库的 collection，语义检索不限定 collection 就会把别库页面当本库命中；两道防线（检索带限定 + 整形按归属兜底）。
- [[主库-子库模型-一个主库-n-个工作区子库]] 主库-子库模型（一个主库 + N 个工作区子库） — 本机唯一主库（~/.dsh/.wiki）存跨项目通用知识，各工作区 .wiki 为子库；写入默认子库、target=main 才写主库；检索子库候选<3 才扩主库并标 vault=main；KNJ_OBSIDIAN_SUBVAULTS=off 一键回滚。
- [[会话级知识库绑定]] 会话级知识库绑定与两条答偏路径 — 为什么知识库检索会答偏：全局单值当前库 + 内存/磁盘不一致 + 向上找 .wiki 无边界；修法是按 session.header.cwd 只读解析、解析不出则静默（工具侧已于 2026-10-21 落地同一契约）。
- [[只改编译产物的修复会被下一次构建静默回滚]] 只改编译产物的修复会被下一次构建静默回滚 — 只改编译产物 lib/ 不改 src/ 的修复，会在下一次 npm run build 时被 tsc 静默回滚；附时间戳对账法与此前所有测试都绿的三个原因。
- [[失败复发检测信号]] 失败复发检测信号（L3 签名判据与假阳性） — L3 的失败签名 = 工具名::命令指纹::错误指纹；tool/result 嵌套结构与无 name 的实测真相，以及弱模式假阳性的修复。
- [[插件验证纪律与实测陷阱]] 插件验证纪律与实测陷阱（假绿、假计数、静默失败） — 六类可复现的验证陷阱：假绿（不构建就测）、夹具形状、假计数、漏 await 的静默失败、锚点/字符类/贪婪正则、PowerShell 写坏 UTF-8。
- [[版本号方案-npm-latest-单调递增]] 版本号方案：npm latest 的单调递增约束（按包独立） — 版本号按包独立递增（每包当月第 N 次发 = YYYY.MM.N）；已发出的号想改只能 unpublish，而 unpublish 需 2FA 会话（bypass-2FA 令牌被硬禁、网页无入口、镜像不联动删）；2026-10-31 最终把 9 包统一重发为 2026.11.9，下个号 2026.11.10。
- [[知识库写入侧零推动]] 知识库写入侧零推动（L5 移除与写入闸默认 off） — 写入必须由用户决定的决策：L5 沉淀提醒为何被整体移除、写入闸为何必须默认 off（UI 蒸馏与模型自行写库共用 wiki_ingest 这一个工具名）。
- [[知识库读取触发层设计]] 知识库读取触发层设计（L0–L3 + 已移除的 L5） — 何时该主动查知识库：三条判据（最早可逆/重合度足够/每任务至多一次）与 L0 库身份、L1 两档漏斗、L2 合取门、L3 复发信号的分工与默认开关。
- [[语义层未就绪的诊断口径-require-假阴性-被吞掉的真实错误-永久失败缓存]] 语义层未就绪的诊断口径：require 假阴性、被吞掉的真实错误、永久失败缓存 — 「@tobilu/qmd 未安装」曾是被 require 假阴性和被 catch{} 吞掉的错误共同制造的错误结论；诊断必须用 await import 并读出 loadError。
- [[语义融合会顶掉正确的词面-top1]] 语义融合会顶掉正确的词面 Top1 — retrieve() 的语义融合丢掉通道内排序（扁平 base=3）再用度/tier 重排，会把语义通道里排最后的 hub 页顶成 Top1；实测放宽兜底门让 Top1 精度 6/10→4/10，故兜底只在候选<2 时发生。

## 实体页


## 字典


## 数据结构

- [[table-change-log]] change_log 变化日志表 — SSE 断线追赶事实源：主键 (tenant_id, version) 组合，避免多租户 version 撞键
- [[table-menu-item]] menu_item 菜单目录表 — 租户级菜单目录表：业务 id 为 VARCHAR(64)，快照规则使其非计费真源，available 为售罄软开关
- [[table-order-item]] order_item 订单项表 — 订单项事实表：一份菜一行、无数量列；菜名与单价均为下单时快照
- [[table-orders]] orders 订单表 — 订单事实表（只增不改）：table_id 为下单时桌号快照，归属日期由 submitted_at 决定
- [[table-table-session]] table_session 桌台会话表 — 桌台会话表：一次就餐容器；(tenant_id, table_id) 部分唯一索引保证同租户同桌仅一个 OPEN 会话
- [[table-task]] task 出品任务表 — 出品任务表：全系统唯一状态实体，(tenant_id, order_item_id) 唯一幂等键防事件重放重复出品
- [[table-tenant]] public.tenant 租户注册表 — 租户注册表：id(UUID)+code(VARCHAR) 双标识，共享表模型中租户列表的唯一来源

## 参考资料

- [[deepwiki-open-方法考古-代码逆向为-wiki-的提示词与工程配置]] DeepWiki-Open 方法考古：代码逆向为 wiki 的提示词与工程配置 — DeepWiki-Open（MIT，commit d92819a）的方法考古：两段管线（file_tree+README 定结构 → 逐页生成）、九段式页面提示词、Mermaid 强制竖排、Sources 引用格式与 ≥5 源文件纪律、排除清单与 8192 token 分块；明确该抄与不该抄。
- [[dsh-web-知识库调用排查-会话索引]] 会话索引：dsh web 知识库调用问题排查 — 2026-10-11~13 单会话蒸馏的溯源清单：会话概要与本批 6 张主题页的去向，以及待办的闭环状态（2026-10-24 复核全部闭环）。
- [[dsh-插件宿主接口契约]] DSH 插件宿主接口契约（钩子、事件、日志解码） — DSH 宿主插件可用的钩子（agent/session-start、agent/pre-step、tools/pre-execute…）、事件结构与会话日志 zstd 解码的实测契约。

## 综合


## 项目知识

- [[capability-主动触发层]] 主动触发层 — agent 不主动查库时插件自己递知识：L0 库身份双挂 agent/created 与 legacy session-start，L1 两档、L3 复发（签名≥3 次）挂在 pre-step/turn-stopping，写入闸与 L2 改动门同在 tools/pre-execute，两门默认 off。
- [[capability-知识写入]] 知识写入 — 把外部材料写成知识页的全部通道：3 个写入工具 + 2 条写路由；按会话 cwd 选库、写前自动建还原点、contentHash 跳重、跨源加后缀、写后重建索引并排语义刷新。
- [[capability-知识检索]] 知识检索（SDD 版） — 知识检索功能的业务认知理解：4 个工具 + 1 条 HTTP 路由共享三套内核，按代价递进分工；语义层按名次递减且整层垫底，只补召回不抢排序；qmd 走独立运行时目录，不进 profile 依赖图。
- [[capability-知识治理]] 知识治理 — 库健康度的检查与修复通道：lint 查孤儿/断链/标签（先剥代码区、index 不计孤儿）、checkpoint 可回滚（merge 默认非破坏、exact 删新页）、mine 两阶段挖代码结构、init 幂等建库、export 出图。写后治理，不改变已有内容。
- [[capability-边栏-ui]] 边栏 UI — dsh web 右侧栏的知识库面板：0.2 原生页签注册、按会话 cwd 解析库根、所有 /api/obsidian-wiki 请求带 ?root=，外加蒸馏启动器、图谱视图与构建产物护栏。
