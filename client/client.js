window.__ModuleLoader__.load({
	id: "dsh-knj-obsidian",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		const BASE = "/api/obsidian-wiki";
		async function getJson(path) {
			const res = await fetch(path);
			if (!res.ok) throw new Error(`wiki api ${path}: ${res.status}`);
			return res.json();
		}
		function fetchPages() {
			return getJson(`${BASE}/pages`);
		}
		function fetchSearch(q, mode = "auto") {
			return getJson(`${BASE}/search?q=${encodeURIComponent(q)}&mode=${mode}`);
		}
		function fetchLint() {
			return getJson(`${BASE}/lint`);
		}
		//#endregion
		//#region src/client/VaultTree.tsx
		const CATEGORY_LABELS = {
			concepts: "概念",
			entities: "实体",
			references: "参考",
			synthesis: "综合",
			projects: "项目"
		};
		function VaultTree({ onOpen }) {
			const [pages, setPages] = (0, react.useState)([]);
			const [error, setError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				fetchPages().then((r) => setPages(r.pages)).catch((e) => setError(String(e)));
			}, []);
			if (error) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					color: "#f87171",
					fontSize: 12
				},
				children: ["加载失败：", error]
			});
			if (pages.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: 16,
					fontSize: 13,
					color: "#9ca3af",
					textAlign: "center"
				},
				children: [
					"知识库还是空的。",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
					"对 agent 说「把 XX 吸收进 wiki」开始。"
				]
			});
			const groups = /* @__PURE__ */ new Map();
			for (const p of pages) {
				const list = groups.get(p.category) ?? [];
				list.push(p);
				groups.set(p.category, list);
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: { fontSize: 13 },
				children: [...groups.entries()].map(([cat, list]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						padding: "6px 8px",
						fontWeight: 600,
						color: "#d1d5db",
						borderBottom: "1px solid #1f2937"
					},
					children: [
						CATEGORY_LABELS[cat] ?? cat,
						"（",
						list.length,
						"）"
					]
				}), list.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					onClick: () => onOpen(p),
					style: {
						padding: "4px 8px 4px 20px",
						cursor: "pointer",
						color: "#e5e7eb"
					},
					onMouseEnter: (e) => {
						e.currentTarget.style.background = "#1f2937";
					},
					onMouseLeave: (e) => {
						e.currentTarget.style.background = "transparent";
					},
					children: p.title
				}, p.id))] }, cat))
			});
		}
		//#endregion
		//#region src/client/SearchBox.tsx
		function SearchBox({ onResult }) {
			const [q, setQ] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const run = async () => {
				if (!q.trim()) return;
				setBusy(true);
				try {
					onResult((await fetchSearch(q)).candidates);
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					gap: 6,
					padding: 8
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					value: q,
					onChange: (e) => setQ(e.target.value),
					onKeyDown: (e) => {
						if (e.key === "Enter") run();
					},
					placeholder: "搜索知识库…",
					style: {
						flex: 1,
						background: "#1f2937",
						border: "1px solid #374151",
						color: "#e5e7eb",
						borderRadius: 6,
						padding: "5px 8px",
						fontSize: 13
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					onClick: run,
					disabled: busy,
					style: {
						background: "#3b82f6",
						border: "none",
						color: "#fff",
						borderRadius: 6,
						padding: "5px 10px",
						fontSize: 13,
						cursor: "pointer"
					},
					children: busy ? "…" : "搜"
				})]
			});
		}
		//#endregion
		//#region src/client/LintBadge.tsx
		function LintBadge() {
			const [report, setReport] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				fetchLint().then((r) => setReport({
					pageCount: r.pageCount,
					issues: r.orphans.length + r.brokenLinks.length + r.missingFrontmatter.length
				})).catch(() => {});
			}, []);
			if (!report) return null;
			const color = report.issues === 0 ? "#22c55e" : report.issues < 5 ? "#f59e0b" : "#ef4444";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					justifyContent: "space-between",
					padding: "4px 8px",
					fontSize: 12,
					color: "#9ca3af"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [report.pageCount, " 页"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: { color },
					children: report.issues === 0 ? "健康" : `${report.issues} 个问题`
				})]
			});
		}
		//#endregion
		//#region src/client/WikiSidebar.tsx
		/**
		* 知识库边栏标签：顶部搜索 + lint 徽标，下方按 category 分组的 vault 树。
		* 搜索后切换为结果列表；图视图为 Task 5。
		*/
		function WikiSidebar() {
			const [results, setResults] = (0, react.useState)(null);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					height: "100%"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchBox, { onResult: setResults }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LintBadge, {}),
					results !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							flex: 1,
							overflow: "auto"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									padding: "4px 8px",
									fontWeight: 600,
									color: "#d1d5db",
									fontSize: 12
								},
								children: [
									"搜索结果（",
									results.length,
									"）"
								]
							}),
							results.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									padding: 12,
									fontSize: 12,
									color: "#9ca3af"
								},
								children: "无匹配"
							}),
							results.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									padding: "6px 8px",
									borderBottom: "1px solid #1f2937"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											color: "#e5e7eb",
											fontSize: 13
										},
										children: c.title
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											color: "#6b7280",
											fontSize: 11
										},
										children: [
											c.category,
											" · ",
											c.confidence
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											color: "#9ca3af",
											fontSize: 11,
											marginTop: 2
										},
										children: c.snippet
									})
								]
							}, c.id))
						]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							overflow: "auto"
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VaultTree, { onOpen: () => {} })
					})
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-knj-obsidian client: registers the "知识库" tab in the right sidebar
		* (better-sidebar). Built by tsdown into client/client.js.
		*/
		const name = "dsh-knj-obsidian";
		const inject = ["betterSidebar"];
		function apply(ctx) {
			ctx.effect(() => {
				if (!ctx.betterSidebar) return;
				return ctx.betterSidebar.registerTab({
					id: "dsh-knj-obsidian",
					title: "知识库",
					component: () => (0, react.createElement)(WikiSidebar)
				});
			}, "dsh-knj-obsidian: sidebar tab");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map