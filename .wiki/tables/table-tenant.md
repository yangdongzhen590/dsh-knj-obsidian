---
id: table-tenant
title: public.tenant 租户注册表
category: tables
tags: [table, module:db]
summary: 租户注册表：id(UUID)+code(VARCHAR) 双标识，共享表模型中租户列表的唯一来源
tier: core
source: mine:db:db/V1__public.sql
confidence: extracted
created: 2026-10-16T16:34:03.147Z
updated: 2026-10-16T16:34:03.147Z
---

租户注册表：每行一家餐馆（一个租户）。共享表 + tenant_id 模型中它是「有哪些租户」的唯一来源（旧 schema-per-tenant 模型可由 schema 列表推导，已废弃）。

## 列清单

| 列 | 类型 | 可空 | 注释 | 主键 |
|---|---|---|---|---|
| id | UUID | NOT NULL | 内部主键；业务表 tenant_id 指向它，JOIN/比较全用它 | PK |
| code | VARCHAR(32) | NOT NULL | 客户端请求头携带的稳定标识（如 pilot-a），供人读写/出现在二维码与配置 | UNIQUE |
| display_name | VARCHAR(128) | NOT NULL | 显示名 | |
| enabled | BOOLEAN | NOT NULL (默认 TRUE) | 启用开关 | |
| created_at | TIMESTAMPTZ | NOT NULL (默认 now()) | 创建时间 | |

## 设计要点
- **id/code 各行其职不混用**：请求入口用 code 解析出 id 再绑定；之后每条查询只比较 UUID，无需 JOIN 注册表。
- **不用 code 直接当 tenant_id**：(1) 避免每次查询比较文本；(2) 拼错的 code 会在入口解析失败即 400，写不出孤儿数据。
- **已删除列**：schema_name（属已废弃的 schema-per-tenant）；id 曾为 VARCHAR 的旧形态需手工迁移。
- 应用运行角色（ptapopr）仅需 SELECT 以解析租户；DDL 由建表角色（ptapdata）执行。

## 关联
- 所有业务表（[[table-table-session]]、[[table-orders]]、[[table-order-item]]、[[table-task]]、[[table-change-log]]、[[table-menu-item]]）的 tenant_id 逻辑上指向本表，但**无外键**（知情取舍：表只增不改、无级联删除，加外键会让清理测试数据必须按依赖顺序删）。
