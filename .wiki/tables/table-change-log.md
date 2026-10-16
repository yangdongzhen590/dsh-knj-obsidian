---
id: table-change-log
title: change_log 变化日志表
category: tables
tags: [table, module:db]
summary: SSE 断线追赶事实源：主键 (tenant_id, version) 组合，避免多租户 version 撞键
tier: supporting
source: mine:db:db/V1__basetables.sql
confidence: extracted
created: 2026-10-16T16:34:54.147Z
updated: 2026-10-16T16:34:54.147Z
---

变化日志：SSE 断线追赶的事实来源。

## 列清单

| 列 | 类型 | 可空 | 注释 | 主键 |
|---|---|---|---|---|
| tenant_id | UUID | NOT NULL | 租户归属 | PK(组合) |
| version | BIGINT | NOT NULL | 每租户递增的变化版本号（进程内计数器，单写者） | PK(组合) |
| entity_type | VARCHAR(24) | NOT NULL | 变化实体类型（unknown：DDL 未列枚举） | |
| entity_id | UUID | NOT NULL | 变化实体 id | |
| station_id | VARCHAR(32) | 可空 | 档口（按档口过滤用） | |
| session_id | UUID | 可空 | 会话 | |
| changed_at | TIMESTAMPTZ | NOT NULL (默认 now()) | 变化时间 | |

## 主键设计（关键取舍）
主键是 **(tenant_id, version)** 而非单独 version：多租户共用同一进程，租户间会出现相同 version 值；若 version 单独作主键，第二个租户写入即撞主键——一个「只有第二家店开业才暴露」的缺陷。

## 索引
- `ix_change_log_tenant_station` (tenant_id, station_id, version)
