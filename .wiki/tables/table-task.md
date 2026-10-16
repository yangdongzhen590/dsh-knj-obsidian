---
id: table-task
title: task 出品任务表
category: tables
tags: [table, module:db]
summary: 出品任务表：全系统唯一状态实体，(tenant_id, order_item_id) 唯一幂等键防事件重放重复出品
tier: core
source: mine:db:db/V1__basetables.sql
confidence: extracted
created: 2026-10-16T16:34:54.147Z
updated: 2026-10-16T16:34:54.147Z
---

出品任务：**全系统唯一持有状态的实体**，粒度 = 菜品的一份。

## 列清单

| 列 | 类型 | 可空 | 注释 | 主键 |
|---|---|---|---|---|
| id | UUID | NOT NULL | | PK |
| tenant_id | UUID | NOT NULL | 租户归属 | |
| order_item_id | UUID | NOT NULL | FK → [[table-order-item]].id；幂等键 | |
| session_id | UUID | NOT NULL | 冗余自订单（免反查） | |
| table_id | VARCHAR(32) | NOT NULL | 桌号快照 | |
| station_id | VARCHAR(32) | NOT NULL | 档口 | |
| name_snapshot | VARCHAR(128) | NOT NULL | 菜名快照 | |
| seq_no | INT | NOT NULL | 序号 | |
| total_of_name | INT | NOT NULL | 同名菜总数（用于「已上 1/2」） | |
| status | VARCHAR(16) | NOT NULL | 状态机；具体取值由 Java 侧 TaskStatus 推导（DDL 未声明字面量，unknown） | |
| cancel_reason | VARCHAR(32) | 可空 | 取消原因 | |
| created_at / accepted_at / ready_at / served_at | TIMESTAMPTZ | created NOT NULL，余可空 | 状态时间戳 | |

## 索引
- `ux_task_tenant_order_item` UNIQUE (tenant_id, order_item_id) —— 以订单项为幂等键：事件重放不得重复出品；带 tenant_id 使跨租户 order_item_id 撞车物理上不可能。
- `ix_task_tenant_station_status` (tenant_id, station_id, status) —— 厨房屏按档口热路径
- `ix_task_tenant_session` (tenant_id, session_id)
