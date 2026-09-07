/**
 * dsh-knj-obsidian 客户端样式（设计系统 v2）
 *
 * 设计方向：宿主原生（native to DSH）。
 * - 全部颜色/字体/圆角/阴影走宿主令牌（--dsw-alias-* / --dsw-static-* / --dsw-font-*），
 *   随宿主浅/深主题自动适配，不再出现任何硬编码色值。
 * - 单一强调色（DeepSeek 蓝，--dsw-alias-brand-primary-new-color）：主操作/焦点/选中态。
 * - 间距刻度 4/8/12/16/24；圆角统一 8px；一条 border 阶梯；阴影仅弹层使用。
 * - 所有选择器以 .knj-wiki 为根作用域，避免污染宿主全局样式。
 */
export const WIKI_CSS = /* css */ `
.knj-wiki {
  /* ---- 令牌映射（宿主别名 → 插件语义），全部带兜底值 ---- */
  --knj-accent: var(--dsw-alias-brand-primary-new-color, #5686fe);
  --knj-accent-strong: var(--dsw-alias-button-info-fill, #4176e6);
  --knj-bg: var(--dsw-alias-bg-base, #151517);
  --knj-bg-1: var(--dsw-alias-bg-layer-1, #232324);
  --knj-bg-2: var(--dsw-alias-bg-layer-2, #2c2c2e);
  --knj-bg-3: var(--dsw-alias-bg-layer-3, #353638);
  --knj-border: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.12));
  --knj-border-soft: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.06));
  --knj-border-strong: var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.16));
  --knj-text: var(--dsw-alias-label-primary, #f9fafb);
  --knj-text-2: var(--dsw-alias-label-secondary, #adb2b8);
  --knj-text-3: var(--dsw-alias-label-tertiary, #81858c);
  --knj-text-dim: var(--dsw-alias-label-dimmed, #43454a);
  --knj-hover: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
  --knj-active: var(--dsw-alias-interactive-bg-active, rgba(255, 255, 255, 0.14));
  --knj-success: var(--dsw-alias-state-success-primary, #22c55e);
  --knj-warn: var(--dsw-alias-state-warn-primary, #f59e0b);
  --knj-error: var(--dsw-alias-state-error-primary, #f25a5a);
  --knj-hover-danger: var(--dsw-alias-interactive-bg-hover-danger, rgba(242, 90, 90, 0.15));
  --knj-radius-s: 8px;
  --knj-radius-m: 12px;
  --knj-font-code: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Consolas, monospace);
  /* 分类语义色（宿主 static 400 级，浅/深主题均可读） */
  --knj-cat-concepts: var(--dsw-static-deepseek-400, #679efe);
  --knj-cat-entities: var(--dsw-static-green-400, #4ed17e);
  --knj-cat-references: var(--dsw-static-amber-400, #f7ad31);
  --knj-cat-synthesis: var(--dsw-static-blue-400, #60a5fa);
  --knj-cat-projects: var(--dsw-static-neutral-500, #7f8287);
  --knj-cat-dictionaries: var(--dsw-static-purple-400, #c084fc);
  --knj-cat-tables: var(--dsw-static-cyan-400, #22d3ee);

  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  font-size: 13px;
  line-height: 20px;
  color: var(--knj-text);
  height: 100%;
  /* v9 宽度自防御：宿主链 .panelBody/.workbench/.splitChild 均为 display:flex（默认 row），
     只声明 height 不声明宽度时，作为行向 flex 子项宽度退化为内容宽度（整个面板"宽度很小"）。
     width:100% 在 block / flex-column / flex-row 三种父容器下都正确撑满。 */
  width: 100%;
  /* v10 外部钳制防御：其他插件/皮肤可能注入全局规则给任意元素设 max-width/min-width
     （实测 dsh-knj-workflow 的全局 .knj-col 规则 max-width:300px 曾把根节点钳在 ~300px）。
     根节点显式 max-width:none + min-width:0，不依赖撞名侥幸。 */
  max-width: none;
  min-width: 0;
  box-sizing: border-box;
}
.knj-wiki *, .knj-wiki *::before, .knj-wiki *::after { box-sizing: border-box; }
.knj-wiki button, .knj-wiki input, .knj-wiki select, .knj-wiki textarea { font-family: inherit; }

/* ============ 布局 ============ */
/* v10 撞名更名：结构布局类用 knj-vcol/knj-hrow——同作者 dsh-knj-workflow 注入未作用域化的
   全局 .knj-col 规则（flex:1 / min-width:210px / max-width:300px）与 .knj-row 规则（margin-bottom:12px），
   会钳制/污染同名类。改名后不再处于撞名区（防御契约见 design-system.test.mjs v10）。
   注意：knj-vcol/knj-grow/knj-scroll 可能直接挂在 .knj-wiki 根节点上（如 WikiSidebar 根），
   必须同时提供复合选择器 .knj-wiki.knj-vcol 才能命中同节点双类（后代选择器不匹配自身）。 */
.knj-wiki .knj-vcol, .knj-wiki.knj-vcol { display: flex; flex-direction: column; }
.knj-wiki .knj-grow { flex: 1 1 auto; min-height: 0; }
.knj-wiki .knj-scroll { overflow-y: auto; overflow-x: hidden; }
/* 空态撑满滚动内容区，配合 knj-empty 的 flex 居中实现垂直居中（对齐工作台空态行为） */
.knj-wiki .knj-scroll > .knj-empty { height: 100%; }
.knj-wiki .knj-pad { padding: 12px; }
.knj-wiki .knj-hrow { display: flex; align-items: center; gap: 8px; }
.knj-wiki .knj-hairline { border-top: 1px solid var(--knj-border-soft); }

/* ============ 按钮 ============ */
.knj-wiki .knj-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: auto; /* v10：防 dsh-knj-workflow 全局 .knj-btn{height:32px} 渗入 */
  border: 1px solid transparent; border-radius: var(--knj-radius-s);
  padding: 5px 10px; font-size: 12px; line-height: 18px; font-weight: 500;
  color: var(--knj-text-2); background: transparent; cursor: pointer;
  white-space: nowrap; user-select: none;
  transition: background .12s ease, border-color .12s ease, color .12s ease, opacity .12s ease, filter .12s ease;
}
.knj-wiki .knj-btn svg { flex-shrink: 0; }
.knj-wiki .knj-btn:hover:not(:disabled) { background: var(--knj-hover); color: var(--knj-text); }
.knj-wiki .knj-btn:active:not(:disabled) { background: var(--knj-active); }
.knj-wiki .knj-btn:focus-visible { outline: 2px solid color-mix(in srgb, var(--knj-accent) 55%, transparent); outline-offset: 1px; }
.knj-wiki .knj-btn:disabled { opacity: .4; cursor: not-allowed; }
.knj-wiki .knj-btn--subtle { background: var(--knj-bg-2); border-color: var(--knj-border); color: var(--knj-text); }
.knj-wiki .knj-btn--subtle:hover:not(:disabled) { background: var(--knj-bg-3); color: var(--knj-text); }
.knj-wiki .knj-btn--primary { background: var(--knj-accent); color: #fff; }
.knj-wiki .knj-btn--primary:hover:not(:disabled) { background: var(--knj-accent); filter: brightness(1.1); color: #fff; }
.knj-wiki .knj-btn--primary:disabled { background: var(--knj-accent); }
.knj-wiki .knj-btn--ghost-danger { color: var(--knj-error); }
.knj-wiki .knj-btn--ghost-danger:hover:not(:disabled) { background: var(--knj-hover-danger); color: var(--knj-error); }
.knj-wiki .knj-btn--sm { padding: 3px 8px; font-size: 12px; line-height: 16px; }
.knj-wiki .knj-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0; border: none; border-radius: 6px;
  color: var(--knj-text-2); background: transparent; cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.knj-wiki .knj-icon-btn:hover:not(:disabled) { background: var(--knj-hover); color: var(--knj-text); }
.knj-wiki .knj-icon-btn:disabled { opacity: .4; cursor: not-allowed; }
.knj-wiki .knj-icon-btn:focus-visible { outline: 2px solid color-mix(in srgb, var(--knj-accent) 55%, transparent); outline-offset: 1px; }
.knj-wiki .knj-icon-btn--danger:hover { background: var(--knj-hover-danger); color: var(--knj-error); }

/* ============ 输入 / 选择 ============ */
.knj-wiki .knj-input, .knj-wiki .knj-select {
  height: auto; /* v10：防 dsh-knj-workflow 全局 .knj-input{height:36px} 渗入 */
  width: 100%; background: var(--knj-bg-2); color: var(--knj-text);
  border: 1px solid var(--knj-border); border-radius: var(--knj-radius-s);
  padding: 6px 10px; font-size: 13px; line-height: 20px; outline: none;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.knj-wiki .knj-input::placeholder { color: var(--knj-text-3); }
.knj-wiki .knj-input:hover, .knj-wiki .knj-select:hover { border-color: var(--knj-border-strong); }
.knj-wiki .knj-input:focus, .knj-wiki .knj-select:focus {
  border-color: var(--knj-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--knj-accent) 25%, transparent);
}
.knj-wiki .knj-select { appearance: none; -webkit-appearance: none; cursor: pointer; padding-right: 26px;
  background-image: linear-gradient(45deg, transparent 50%, var(--knj-text-3) 50%), linear-gradient(135deg, var(--knj-text-3) 50%, transparent 50%);
  background-position: calc(100% - 15px) 55%, calc(100% - 10px) 55%;
  background-size: 5px 5px; background-repeat: no-repeat; }

/* ============ 搜索框 ============ */
/* v10 撞名中和：dsh-knj-workflow 全局 .knj-search{flex:1;min-width:140px;max-width:260px;height:30px;
   border-radius:999px;border;background;padding:0 12px} 会钳窄/压扁搜索框并做成药丸形，
   此处显式声明全部漏属性，还原为普通输入框容器（尺寸交给内部 knj-input）。 */
.knj-wiki .knj-search { position: relative; height: auto; max-width: none; min-width: 0; flex: 0 1 auto; border: none; background: transparent; border-radius: 0; font-size: inherit; }
.knj-wiki .knj-search__icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--knj-text-3); display: inline-flex; pointer-events: none; }
.knj-wiki .knj-search__input { padding-left: 32px; padding-right: 30px; }
.knj-wiki .knj-search__clear { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); }
.knj-wiki .knj-search__spinner { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); color: var(--knj-text-3); animation: knj-spin .8s linear infinite; }
@keyframes knj-spin { to { transform: translateY(-50%) rotate(360deg); } }

/* ============ 分段切换（浏览/图谱） ============ */
.knj-wiki .knj-seg { display: inline-flex; background: var(--knj-bg-1); border: 1px solid var(--knj-border-soft); border-radius: var(--knj-radius-s); padding: 2px; gap: 2px; }
.knj-wiki .knj-seg__item { display: inline-flex; align-items: center; gap: 6px; border: none; background: transparent; color: var(--knj-text-3); padding: 4px 12px; border-radius: 6px; font-size: 12px; line-height: 18px; font-weight: 500; cursor: pointer; transition: background .12s ease, color .12s ease; }
.knj-wiki .knj-seg__item:hover { color: var(--knj-text); }
.knj-wiki .knj-seg__item--active { background: var(--knj-bg-2); color: var(--knj-text); box-shadow: 0 1px 2px rgba(0, 0, 0, .25); }

/* ============ Vault 头部 ============ */
.knj-wiki .knj-vault { display: flex; flex-direction: column; gap: 8px; padding: 12px 12px 10px; border-bottom: 1px solid var(--knj-border-soft); }
.knj-wiki .knj-vault__identity { display: flex; align-items: center; gap: 8px; min-width: 0; }
.knj-wiki .knj-vault__name { display: inline-flex; align-items: center; gap: 6px; color: var(--knj-text); font-size: 13px; font-weight: 600; line-height: 20px; white-space: nowrap; flex-shrink: 0; }
.knj-wiki .knj-vault__name-text { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.knj-wiki .knj-vault__path { flex: 1 1 auto; min-width: 0; font-size: 11px; line-height: 16px; color: var(--knj-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.knj-wiki .knj-vault__select { margin-top: 0; }
.knj-wiki .knj-vault__manage { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: var(--knj-bg-1); border: 1px solid var(--knj-border-soft); border-radius: var(--knj-radius-s); animation: knj-pop-in .14s ease; }
.knj-wiki .knj-vault__manage-row { display: flex; gap: 6px; }

/* ============ 徽标（计数） ============ */
.knj-wiki .knj-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; font-size: 10px; line-height: 16px; font-weight: 600; }
.knj-wiki .knj-badge--danger { color: #fff; background: var(--knj-error); }
.knj-wiki .knj-badge--warn { color: #1a1204; background: var(--knj-warn); }

/* ============ 图谱节点 / 边 ============ */
.knj-wiki .knj-graph-edge { stroke: var(--knj-border-strong); }
.knj-wiki .knj-graph-edge--broken { stroke: var(--knj-error); stroke-dasharray: 4 3; }
.knj-wiki .knj-graph-node { stroke: var(--knj-bg); stroke-width: 1.5px; transition: filter .12s ease; }
.knj-wiki .knj-graph-node:hover { filter: brightness(1.25); }
.knj-wiki .knj-graph-node--concepts { fill: var(--knj-cat-concepts); }
.knj-wiki .knj-graph-node--entities { fill: var(--knj-cat-entities); }
.knj-wiki .knj-graph-node--references { fill: var(--knj-cat-references); }
.knj-wiki .knj-graph-node--synthesis { fill: var(--knj-cat-synthesis); }
.knj-wiki .knj-graph-node--projects { fill: var(--knj-cat-projects); }
.knj-wiki .knj-graph-node--dictionaries { fill: var(--knj-cat-dictionaries); }
.knj-wiki .knj-graph-node--tables { fill: var(--knj-cat-tables); }
.knj-wiki .knj-graph-node--orphan { fill: var(--knj-bg-3); stroke: var(--knj-border-strong); stroke-dasharray: 3 2; }
.knj-wiki .knj-graph-node--muted { fill: var(--knj-text-dim); }

/* ============ 树提示 ============ */
.knj-wiki .knj-tree__hint { display: flex; align-items: center; gap: 4px; padding: 12px 10px 16px; font-size: 11px; color: var(--knj-text-dim); }

/* ============ 卡片 / 区块标题 ============ */
.knj-wiki .knj-panel { background: var(--knj-bg-1); border: 1px solid var(--knj-border-soft); border-radius: var(--knj-radius-m); }
.knj-wiki .knj-section-title { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; font-weight: 600; color: var(--knj-text-3); }

/* ============ 分类标记 ============ */
.knj-wiki .knj-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px; font-size: 11px; line-height: 16px; font-weight: 500; white-space: nowrap; }
.knj-wiki .knj-chip--concepts { color: var(--knj-cat-concepts); background: color-mix(in srgb, var(--knj-cat-concepts) 14%, transparent); }
.knj-wiki .knj-chip--entities { color: var(--knj-cat-entities); background: color-mix(in srgb, var(--knj-cat-entities) 14%, transparent); }
.knj-wiki .knj-chip--references { color: var(--knj-cat-references); background: color-mix(in srgb, var(--knj-cat-references) 14%, transparent); }
.knj-wiki .knj-chip--synthesis { color: var(--knj-cat-synthesis); background: color-mix(in srgb, var(--knj-cat-synthesis) 14%, transparent); }
.knj-wiki .knj-chip--projects { color: var(--knj-cat-projects); background: color-mix(in srgb, var(--knj-cat-projects) 14%, transparent); }
.knj-wiki .knj-chip--neutral { color: var(--knj-text-3); background: var(--knj-bg-1); }
.knj-wiki .knj-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.knj-wiki .knj-dot--ok { background: var(--knj-success); }
.knj-wiki .knj-dot--warn { background: var(--knj-warn); }
.knj-wiki .knj-dot--err { background: var(--knj-error); }
.knj-wiki .knj-dot--muted { background: var(--knj-text-dim); }

/* ============ 文件树（浏览视图，Obsidian 式：目录层层展开） ============ */
.knj-wiki .knj-tree { display: flex; flex-direction: column; gap: 1px; padding: 6px 4px; }
.knj-wiki .knj-tree__dir { display: flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: var(--knj-radius-s); cursor: pointer; user-select: none; color: var(--knj-text-2); line-height: 22px; transition: background .1s ease; }
.knj-wiki .knj-tree__dir:hover { background: var(--knj-hover); }
.knj-wiki .knj-tree__chev { display: inline-flex; color: var(--knj-text-3); transition: transform .12s ease; flex-shrink: 0; }
.knj-wiki .knj-tree__dir--open .knj-tree__chev { transform: rotate(90deg); }
.knj-wiki .knj-tree__dir-icon { display: inline-flex; flex-shrink: 0; }
.knj-wiki .knj-tree__dir-icon--concepts { color: var(--knj-cat-concepts); }
.knj-wiki .knj-tree__dir-icon--entities { color: var(--knj-cat-entities); }
.knj-wiki .knj-tree__dir-icon--dictionaries { color: var(--knj-cat-dictionaries); }
.knj-wiki .knj-tree__dir-icon--tables { color: var(--knj-cat-tables); }
.knj-wiki .knj-tree__dir-icon--references { color: var(--knj-cat-references); }
.knj-wiki .knj-tree__dir-icon--synthesis { color: var(--knj-cat-synthesis); }
.knj-wiki .knj-tree__dir-icon--projects { color: var(--knj-cat-projects); }
.knj-wiki .knj-tree__dir-name { flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.knj-wiki .knj-tree__count { font-size: 11px; font-weight: 500; color: var(--knj-text-3); background: var(--knj-bg-1); border-radius: 999px; padding: 0 6px; line-height: 15px; }
.knj-wiki .knj-tree__children { display: flex; flex-direction: column; gap: 1px; margin-left: 15px; padding-left: 6px; border-left: 1px solid var(--knj-border-soft); }
.knj-wiki .knj-tree__empty { padding: 2px 8px 6px 30px; font-size: 11px; color: var(--knj-text-dim); }
.knj-wiki .knj-tree__item { display: flex; align-items: center; gap: 7px; padding: 3px 8px; border-radius: var(--knj-radius-s); color: var(--knj-text-2); cursor: pointer; font-size: 13px; line-height: 20px; transition: background .1s ease, color .1s ease; }
.knj-wiki .knj-tree__item:hover { background: var(--knj-hover); color: var(--knj-text); }
.knj-wiki .knj-tree__item-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.knj-wiki .knj-tree__item-icon { display: inline-flex; color: var(--knj-text-3); flex-shrink: 0; }

/* ============ 状态条 / 展开面板 ============ */
.knj-wiki .knj-statusbar { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-top: 1px solid var(--knj-border-soft); background: transparent; }
.knj-wiki .knj-statusbar__meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--knj-text-3); }
.knj-wiki .knj-statusbar__spacer { flex: 1 1 auto; }
.knj-wiki .knj-pop { border-top: 1px solid var(--knj-border-soft); background: var(--knj-bg-1); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; animation: knj-pop-in .14s ease; }
@keyframes knj-pop-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.knj-wiki .knj-pop__row { display: flex; align-items: center; gap: 8px; }
.knj-wiki .knj-pop__label { flex: 1 1 auto; min-width: 0; font-size: 12px; color: var(--knj-text-2); display: flex; align-items: center; gap: 8px; }
.knj-wiki .knj-pop__hint { font-size: 11px; color: var(--knj-text-3); }
.knj-wiki .knj-issue-item { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 6px; font-size: 12px; color: var(--knj-text-2); cursor: pointer; }
.knj-wiki .knj-issue-item:hover { background: var(--knj-hover); color: var(--knj-text); }
.knj-wiki .knj-issue-item--disabled { cursor: default; color: var(--knj-text-3); }
.knj-wiki .knj-issue-item--disabled:hover { background: transparent; }

/* ============ 提示条 ============ */
.knj-wiki .knj-banner { display: flex; align-items: flex-start; gap: 8px; padding: 8px 12px; border-radius: var(--knj-radius-s); font-size: 12px; line-height: 18px; }
.knj-wiki .knj-banner svg { flex-shrink: 0; margin-top: 1px; }
.knj-wiki .knj-banner--ok { color: var(--knj-success); background: color-mix(in srgb, var(--knj-success) 12%, transparent); }
.knj-wiki .knj-banner--warn { color: var(--knj-warn); background: color-mix(in srgb, var(--knj-warn) 12%, transparent); }
.knj-wiki .knj-banner--err { color: var(--knj-error); background: color-mix(in srgb, var(--knj-error) 12%, transparent); }
.knj-wiki .knj-banner--info { color: var(--knj-text-2); background: var(--knj-bg-1); border: 1px solid var(--knj-border-soft); }

/* ============ 空态 / 加载 / 错误 ============ */
.knj-wiki .knj-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 40px 20px; text-align: center; color: var(--knj-text-3); font-size: 12px; line-height: 20px; }
.knj-wiki .knj-empty__icon { color: var(--knj-text-dim); }
.knj-wiki .knj-loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 28px 12px; color: var(--knj-text-3); font-size: 12px; }
.knj-wiki .knj-error { display: flex; align-items: center; gap: 8px; padding: 10px 12px; color: var(--knj-error); font-size: 12px; }
.knj-wiki .knj-spinner { animation: knj-spin .8s linear infinite; display: inline-flex; color: var(--knj-text-3); }

/* ============ 搜索结果 ============ */
.knj-wiki .knj-result-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px 4px; }
.knj-wiki .knj-result-title { font-size: 12px; font-weight: 600; color: var(--knj-text); }
.knj-wiki .knj-result-item { display: flex; flex-direction: column; gap: 3px; padding: 7px 12px; border-radius: var(--knj-radius-s); cursor: pointer; transition: background .1s ease; }
.knj-wiki .knj-result-item:hover { background: var(--knj-hover); }
.knj-wiki .knj-result-item__meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--knj-text-3); }
.knj-wiki .knj-result-item__snippet { font-size: 12px; color: var(--knj-text-3); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* ============ 图谱 ============ */
.knj-wiki .knj-graph-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 12px 0; }
.knj-wiki .knj-graph-stats { font-size: 12px; color: var(--knj-text-3); }
.knj-wiki .knj-graph-legend { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; padding: 8px 12px 4px; }
.knj-wiki .knj-graph-svg { display: block; width: 100%; height: auto; border-radius: var(--knj-radius-m); background: var(--knj-bg-1); border: 1px solid var(--knj-border-soft); }
.knj-wiki .knj-graph-label { fill: var(--knj-text-2); font-size: 11px; pointer-events: none; }

/* ============ 图谱全屏（v10） ============ */
.knj-wiki .knj-graph-fs { position: fixed; inset: 0; z-index: 2147483000; background: var(--dsw-alias-canvas-background, var(--knj-bg-0, #101216)); animation: knj-fade-in .12s ease; }
.knj-wiki .knj-graph-fs__head { display: flex; align-items: center; gap: 10px; }
.knj-wiki .knj-graph-fs__row { display: flex; gap: 12px; flex: 1 1 auto; min-height: 0; }
/* 全屏页签化（v10） */
.knj-wiki .knj-fsbar { display: flex; align-items: center; gap: 10px; min-width: 0; flex-shrink: 0; }
.knj-wiki .knj-fsbar__sep { width: 1px; height: 18px; background: var(--knj-border-soft); flex-shrink: 0; }
.knj-wiki .knj-fstabs { display: flex; align-items: center; gap: 4px; min-width: 0; overflow-x: auto; flex: 1 1 auto; }
.knj-wiki .knj-fstab { display: inline-flex; align-items: center; gap: 6px; max-width: 220px; padding: 3px 8px 3px 10px; border-radius: 7px; font-size: 12px; line-height: 18px; color: var(--knj-text-2); background: var(--knj-bg-1); border: 1px solid var(--knj-border-soft); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0; }
.knj-wiki .knj-fstab:hover { color: var(--knj-text); }
.knj-wiki .knj-fstab--active { color: var(--knj-text); background: var(--knj-bg-2); border-color: var(--knj-border-strong); }
.knj-wiki .knj-fstab__close { display: inline-flex; padding: 0; margin: 0; border: none; background: transparent; color: var(--knj-text-3); cursor: pointer; flex-shrink: 0; }
.knj-wiki .knj-fstab__close:hover { color: var(--knj-text); }
.knj-wiki .knj-fscanvas { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; }
.knj-wiki .knj-graph-fs .knj-graph-svg { height: 100% !important; border: none; }
.knj-wiki .knj-fspage { flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; background: var(--knj-bg-1); border: 1px solid var(--knj-border-soft); border-radius: var(--knj-radius-m); overflow: hidden; }
.knj-wiki .knj-fspage__inner { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.knj-wiki .knj-fspage__bar { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--knj-border-soft); flex-shrink: 0; }
.knj-wiki .knj-fspage__title { font-size: 13px; font-weight: 600; color: var(--knj-text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.knj-wiki .knj-fspage__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px 24px 32px; }
@keyframes knj-fade-in { from { opacity: 0; } to { opacity: 1; } }

/* ============ 笔记工作台 ============ */
/* v11 滚动根容器：笔记 tab 渲染在右侧面板（宿主 paneContent overflow:hidden，无主区域滚动容器），
   根容器必须自备 height:100% + overflow-y:auto，内容超高时出现纵向滚动条（修正 v8 的错误假设）。 */
.knj-wiki.knj-wb-scroll { height: 100%; overflow-y: auto; overflow-x: hidden; }
.knj-wiki .knj-wb { padding: 20px 28px 48px; max-width: 880px; margin: 0 auto; }
.knj-wiki .knj-wb__title { margin: 0 0 4px; font-size: var(--dsw-font-xl-24-font-size, 24px); line-height: var(--dsw-font-xl-24-line-height, 32px); font-weight: 600; color: var(--knj-text); word-break: break-word; }
.knj-wiki .knj-wb__meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; font-size: 12px; color: var(--knj-text-3); }
.knj-wiki .knj-wb__actions { display: flex; align-items: center; gap: 8px; margin: 10px 0 14px; }
.knj-wiki .knj-wb__back { display: inline-flex; align-items: center; gap: 4px; }
.knj-wiki .knj-wb__editor {
  width: 100%; min-height: 480px; box-sizing: border-box; resize: vertical;
  background: var(--knj-bg-1); color: var(--knj-text); border: 1px solid var(--knj-border);
  border-radius: var(--knj-radius-m); padding: 14px 16px;
  font-family: var(--knj-font-code); font-size: 13px; line-height: 1.65; outline: none;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.knj-wiki .knj-wb__editor:focus { border-color: var(--knj-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--knj-accent) 25%, transparent); }

/* ============ Markdown 内容排版（宿主 markdown 字体阶梯） ============ */
.knj-wiki .wiki-md-content { font-size: var(--dsw-font-markdown-base-font-size, 14px); line-height: var(--dsw-font-markdown-base-line-height, 28px); color: var(--knj-text); word-break: break-word; }
.knj-wiki .wiki-md-content > *:first-child { margin-top: 0; }
.knj-wiki .wiki-md-content h1, .knj-wiki .wiki-md-content h2, .knj-wiki .wiki-md-content h3,
.knj-wiki .wiki-md-content h4, .knj-wiki .wiki-md-content h5, .knj-wiki .wiki-md-content h6 { margin: 22px 0 10px; font-weight: 600; color: var(--knj-text); line-height: 1.35; }
.knj-wiki .wiki-md-content h1 { font-size: 22px; }
.knj-wiki .wiki-md-content h2 { font-size: 19px; }
.knj-wiki .wiki-md-content h3 { font-size: 17px; }
.knj-wiki .wiki-md-content h4, .knj-wiki .wiki-md-content h5, .knj-wiki .wiki-md-content h6 { font-size: 15px; }
.knj-wiki .wiki-md-content p { margin: 8px 0; }
.knj-wiki .wiki-md-content a { color: var(--knj-accent); text-decoration: none; }
.knj-wiki .wiki-md-content a:hover { text-decoration: underline; }
.knj-wiki .wiki-md-content a[data-wikilink] { border-bottom: 1px dashed color-mix(in srgb, var(--knj-accent) 55%, transparent); }
.knj-wiki .wiki-md-content strong { font-weight: 600; }
.knj-wiki .wiki-md-content code { font-family: var(--knj-font-code); font-size: 13px; background: var(--dsw-alias-markdown-inline-code, var(--knj-bg-1)); color: var(--knj-text); padding: 1px 5px; border-radius: 4px; }
.knj-wiki .wiki-md-content pre { background: var(--dsw-alias-markdown-code-block, var(--knj-bg-1)); border: 1px solid var(--knj-border-soft); border-radius: var(--knj-radius-s); padding: 12px 14px; overflow-x: auto; }
.knj-wiki .wiki-md-content pre code { background: transparent; padding: 0; font-size: 13px; line-height: 1.6; }
.knj-wiki .wiki-md-content blockquote { margin: 10px 0; padding: 2px 14px; border-left: 3px solid var(--knj-accent); color: var(--knj-text-2); background: var(--knj-bg-1); border-radius: 0 var(--knj-radius-s) var(--knj-radius-s) 0; }
.knj-wiki .wiki-md-content ul, .knj-wiki .wiki-md-content ol { margin: 8px 0; padding-left: 24px; }
.knj-wiki .wiki-md-content li { margin: 3px 0; }
.knj-wiki .wiki-md-content li input[type="checkbox"] { margin-right: 6px; accent-color: var(--knj-accent); }
.knj-wiki .wiki-md-content table { border-collapse: collapse; margin: 10px 0; width: 100%; font-size: 14px; }
.knj-wiki .wiki-md-content th, .knj-wiki .wiki-md-content td { border: 1px solid var(--knj-border); padding: 6px 10px; text-align: left; }
.knj-wiki .wiki-md-content th { background: var(--knj-bg-1); font-weight: 600; }
.knj-wiki .wiki-md-content hr { border: none; border-top: 1px solid var(--knj-border); margin: 18px 0; }
.knj-wiki .wiki-md-content img { max-width: 100%; border-radius: var(--knj-radius-s); }
.knj-wiki .wiki-md-content del { color: var(--knj-text-3); }
`

/** 注入样式（幂等）：index.ts apply 时调用。 */
export function injectWikiStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-knj-obsidian-styles')) return
  const style = document.createElement('style')
  style.id = 'dsh-knj-obsidian-styles'
  style.setAttribute('data-plugin', 'dsh-knj-obsidian')
  style.textContent = WIKI_CSS
  document.head.appendChild(style)
}

/** 移除注入样式（幂等）：插件卸载/HMR 时调用，避免旧版本样式常驻 DOM。 */
export function removeWikiStyles(): void {
  if (typeof document === 'undefined') return
  document.getElementById('dsh-knj-obsidian-styles')?.remove()
}
