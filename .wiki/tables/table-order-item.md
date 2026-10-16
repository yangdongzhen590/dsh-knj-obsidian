---
id: table-order-item
title: order_item 订单项表
category: tables
tags: [table, module:db]
summary: 订单项事实表：一份菜一行、无数量列；菜名与单价均为下单时快照
tier: core
source: mine:db:db/V1__basetables.sql
confidence: extracted
created: 2026-10-16T16:34:54.147Z
updated: 2026-10-16T16:34:54.147Z
---

订单项：事实层，只增不改。**没有数量列**——数量属于出品任务（设计不变量②），一份菜一个订单项，使「已上 1/2」可计算。

## 列清单

| 列 | 类型 | 可空 | 注释 | 主键 |
|---|---|---|---|---|
| id | UUID | NOT NULL | | PK |
| tenant_id | UUID | NOT NULL | 租户归属 | |
| order_id | UUID | NOT NULL | FK → [[table-orders]].id | |
| menu_item_id | VARCHAR(64) | NOT NULL | 指向 [[table-menu-item]] 的业务 id（同类型 VARCHAR，保证「同一道菜」身份可靠） | |
| name_snapshot | VARCHAR(128) | NOT NULL | 下单时菜名快照（服务器不回读菜单填单） | |
| unit_price_cents | INTEGER | NOT NULL | 下单时单价快照（整型分；全系统无浮点金额）；改菜单价格不改变已提交账单 | |
| seq_no | INT | NOT NULL | 同单内序号 | |
| station_id | VARCHAR(32) | NOT NULL | 档口（客户端可省略，省略时用菜单值，见 menu_item） | |

## 索引
- `ix_order_item_tenant_order` (tenant_id, order_id)
