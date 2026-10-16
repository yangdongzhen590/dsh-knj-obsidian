---
id: table-table-session
title: table_session 桌台会话表
category: tables
tags: [table, module:db]
summary: 桌台会话表：一次就餐容器；(tenant_id, table_id) 部分唯一索引保证同租户同桌仅一个 OPEN 会话
tier: core
source: mine:db:db/V1__basetables.sql
confidence: extracted
created: 2026-10-16T16:34:54.147Z
updated: 2026-10-16T16:34:54.147Z
---

桌台会话：一次就餐的容器，聚合多张订单。所有业务表均为共享表 + tenant_id 判别列模型（非 schema-per-tenant），新开一家店无需跑 DDL。

## 列清单

| 列 | 类型 | 可空 | 注释 | 主键 |
|---|---|---|---|---|
| id | UUID | NOT NULL | | PK |
| tenant_id | UUID | NOT NULL | 租户归属判别列，指向 [[table-tenant]].id | |
| table_id | VARCHAR(32) | NOT NULL | 桌号 | |
| status | VARCHAR(16) | NOT NULL | 取值含 OPEN / SETTLED（推断自索引与报表 SQL） | |
| opened_at | TIMESTAMPTZ | NOT NULL | 开台时间 | |
| settled_at | TIMESTAMPTZ | 可空 | 结账时间 | |
| note | VARCHAR(200) | 可空 | 备注 | |

## 索引
- `ux_session_open_table` UNIQUE (tenant_id, table_id) WHERE status = 'OPEN' —— 同一桌同时只能有一个开放会话（收桌竞态第一道防线）；**必须含 tenant_id**，否则 A 店 3 号桌的开放会话会挡住 B 店 3 号桌开店（静默故障）。
- `ix_session_tenant` (tenant_id)

## 设计要点
- tenant_id 是每一行业务数据的归属判别列，非业务字段；每条查询都必须带它，且每表都有以它开头的索引。
- 禁止 UPDATE [[table-orders]] 等事实表；本表状态可变。
