---
id: table-menu-item
title: menu_item 菜单目录表
category: tables
tags: [table, module:db]
summary: 租户级菜单目录表：业务 id 为 VARCHAR(64)，快照规则使其非计费真源，available 为售罄软开关
tier: core
source: mine:db:db/V2__menu.sql
confidence: extracted
created: 2026-10-16T16:35:33.426Z
updated: 2026-10-16T16:35:33.426Z
---

菜单目录（V2）：每租户可编辑的可售菜品。菜单是**数据**归店家所有，不硬编码在前端/常量里（否则改价/售罄都要发版，店家会用回纸单）。但它**不是计费真源**：[[table-order-item]] 在下单时快照 name 与 unit_price_cents，改/删菜单行不会改已提交账单。

## 列清单

| 列 | 类型 | 可空 | 注释 | 主键 |
|---|---|---|---|---|
| tenant_id | UUID | NOT NULL | 租户归属 | PK(组合) |
| id | VARCHAR(64) | NOT NULL | 调用方提供的稳定业务 id（非 UUID，与 order_item.menu_item_id 同类型，保证「同一道菜」身份可靠） | PK(组合) |
| name | VARCHAR(128) | NOT NULL | 显示名；客户端下单时送快照，服务器不回读 | |
| unit_price_cents | INTEGER | NOT NULL | 单价（整型分）；CHECK >= 0（零允许：赠品/配菜） | |
| station_id | VARCHAR(32) | NOT NULL | 出品档口；客户端省略时任务继承此值 | |
| sort_order | INT | NOT NULL (默认 0) | 点餐屏显示顺序（按菜类分组，非字母序） | |
| available | BOOLEAN | NOT NULL (默认 TRUE) | 售罄软开关：售罄菜留在目录（历史/报表仍引用）但不再提供；刻意不用 DELETE（删行会破坏指向该 id 的历史订单叙事） | |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL (默认 now()) | 时间戳 | |

## 约束与索引
- PK (tenant_id, id)
- CHECK `ck_menu_item_price_non_negative` (unit_price_cents >= 0)
- `ix_menu_item_tenant_available` (tenant_id, available, sort_order) —— 点餐屏热路径「本租户可售菜按显示序」
