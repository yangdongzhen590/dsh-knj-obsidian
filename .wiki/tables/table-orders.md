---
id: table-orders
title: orders 订单表
category: tables
tags: [table, module:db]
summary: 订单事实表（只增不改）：table_id 为下单时桌号快照，归属日期由 submitted_at 决定
tier: core
source: mine:db:db/V1__basetables.sql
confidence: extracted
created: 2026-10-16T16:34:54.147Z
updated: 2026-10-16T16:34:54.147Z
---

订单：事实层，**只增不改**（禁止 UPDATE）。

## 列清单

| 列 | 类型 | 可空 | 注释 | 主键 |
|---|---|---|---|---|
| id | UUID | NOT NULL | | PK |
| tenant_id | UUID | NOT NULL | 租户归属 | |
| session_id | UUID | NOT NULL | FK → [[table-table-session]].id | |
| table_id | VARCHAR(32) | NOT NULL | 下单那一刻的桌号快照（非外键）：使出品任务无需反查会话即可按桌分组，桌台改名不影响历史单据 | |
| channel | VARCHAR(16) | NOT NULL | 下单渠道（unknown：DDL 未注释取值） | |
| submitted_at | TIMESTAMPTZ | NOT NULL | 下单时刻；报表「归属哪一天」由此列决定 | |
| source | VARCHAR(16) | NOT NULL | 来源（unknown：DDL 未注释取值） | |

## 索引
- `ix_orders_tenant_session` (tenant_id, session_id)

## 外键
- session_id → table_session(id)（本脚本中唯一带 REFERENCES 的外键之一）
