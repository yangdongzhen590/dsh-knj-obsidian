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
		/** v5：磁盘原文（含 frontmatter），源码视图/编辑用。 */
		async function fetchRawPage(id, category) {
			const res = await fetch(`${BASE}/page?id=${encodeURIComponent(id)}&category=${encodeURIComponent(category)}&raw=1`);
			const data = await res.json();
			if (!res.ok || data.error) throw new Error(data.error ?? `wiki api: ${res.status}`);
			return data.raw ?? "";
		}
		/** v5：全文保存（同源 JSON POST）。成功返回解析后的页面。 */
		async function saveRawPage(id, category, raw) {
			const res = await fetch(`${BASE}/page?id=${encodeURIComponent(id)}&category=${encodeURIComponent(category)}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ raw })
			});
			const data = await res.json();
			if (!res.ok || data.error) throw new Error(data.error ?? `save failed: ${res.status}`);
			return data.page;
		}
		function fetchSearch(q, mode = "auto") {
			return getJson(`${BASE}/search?q=${encodeURIComponent(q)}&mode=${mode}`);
		}
		function fetchLint() {
			return getJson(`${BASE}/lint`);
		}
		/** v6：重建 index.md（同源 POST）。 */
		async function rebuildIndex() {
			const res = await fetch(`${BASE}/rebuild-index`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}"
			});
			const data = await res.json();
			if (!res.ok || data.error) throw new Error(data.error ?? `rebuild failed: ${res.status}`);
			return { pageCount: data.pageCount ?? 0 };
		}
		/** v6：路径导入 md（同源 POST）。 */
		async function importMd(path, category) {
			const res = await fetch(`${BASE}/import`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					path,
					category
				})
			});
			const data = await res.json();
			if (!res.ok || data.error) throw new Error(data.error ?? `import failed: ${res.status}`);
			return data;
		}
		function fetchVaults() {
			return getJson(`${BASE}/vaults`);
		}
		async function postVault(action, payload) {
			const res = await fetch(`${BASE}/vault/${action}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			});
			const data = await res.json();
			if (!res.ok || data.error) throw new Error(data.error ?? `vault ${action} failed: ${res.status}`);
			return data;
		}
		/** 按目录激活（跟工作区走）：已注册仅切换，未注册自动挂接。 */
		const activateVault = (root) => postVault("activate", { root });
		const switchVault = (id) => postVault("switch", { id });
		const attachVault = (root, name) => postVault("attach", name?.trim() ? {
			root,
			name: name.trim()
		} : { root });
		const removeVault = (id) => postVault("remove", { id });
		//#endregion
		//#region src/client/icons.tsx
		function base(size) {
			return {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.7,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true
			};
		}
		const IconSearch = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			...base(size),
			...rest,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
				cx: "11",
				cy: "11",
				r: "7"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m20 20-3.5-3.5" })]
		});
		const IconClose = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
			...base(size),
			...rest,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6 6l12 12M18 6 6 18" })
		});
		const IconChevronDown = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
			...base(size),
			...rest,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m6 9 6 6 6-6" })
		});
		const IconChevronRight = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
			...base(size),
			...rest,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m9 6 6 6-6 6" })
		});
		const IconGear = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			...base(size),
			...rest,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
				cx: "12",
				cy: "12",
				r: "3"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" })]
		});
		const IconTrash = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			...base(size),
			...rest,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10 11v6M14 11v6" })]
		});
		const IconBook = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			...base(size),
			...rest,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" })]
		});
		const IconFile = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			...base(size),
			...rest,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14 2v5h5" })]
		});
		const IconGraph = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			...base(size),
			...rest,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "6",
					cy: "6",
					r: "2.5"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "18",
					cy: "8",
					r: "2.5"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "9",
					cy: "18",
					r: "2.5"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m8 7.4 8.2 1.2M7.6 8l1.8 8M15.8 9.6 10.2 16.4" })
			]
		});
		const IconRefresh = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
			...base(size),
			...rest,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" })
		});
		const IconImport = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			...base(size),
			...rest,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 3v12m0 0 4-4m-4 4-4-4" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" })]
		});
		const IconSparkles = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			...base(size),
			...rest,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" })]
		});
		const IconCopy = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			...base(size),
			...rest,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
				x: "9",
				y: "9",
				width: "12",
				height: "12",
				rx: "2"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" })]
		});
		const IconCheck = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
			...base(size),
			...rest,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m4 12.5 5 5L20 6.5" })
		});
		const IconBack = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
			...base(size),
			...rest,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M19 12H5m0 0 6-6m-6 6 6 6" })
		});
		const IconWarning = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			...base(size),
			...rest,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 3 2.5 20h19L12 3Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 10v4M12 17.5v.01" })]
		});
		const IconInfo = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			...base(size),
			...rest,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
				cx: "12",
				cy: "12",
				r: "9"
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 11v6M12 7.5v.01" })]
		});
		const IconPlus = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
			...base(size),
			...rest,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12 5v14M5 12h14" })
		});
		const IconLink = ({ size = 16, ...rest }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
			...base(size),
			...rest,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" })]
		});
		//#endregion
		//#region src/client/VaultTree.tsx
		const CATEGORY_LABELS$1 = {
			concepts: "概念",
			entities: "实体",
			references: "参考",
			synthesis: "综合",
			projects: "项目"
		};
		/** confidence 圆点：extracted 实心强调色 / inferred 空心 / ambiguous 琥珀 */
		const CONFIDENCE_DOT = {
			extracted: "knj-dot--ok",
			inferred: "knj-dot--muted",
			ambiguous: "knj-dot--warn"
		};
		function VaultTree({ onOpen }) {
			const [pages, setPages] = (0, react.useState)([]);
			const [error, setError] = (0, react.useState)(null);
			const [loaded, setLoaded] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const load = () => fetchPages().then((r) => {
					setPages(r.pages);
					setLoaded(true);
				}).catch((e) => {
					setError(String(e));
					setLoaded(true);
				});
				load();
				window.addEventListener("wiki:pages-changed", load);
				return () => window.removeEventListener("wiki:pages-changed", load);
			}, []);
			if (error) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-error",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconRefresh, { size: 14 }),
					"加载失败：",
					error
				]
			});
			if (!loaded) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-loading",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "knj-spinner",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconRefresh, { size: 14 })
				}), "加载中…"]
			});
			if (pages.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-empty",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "knj-empty__icon",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconBook, { size: 28 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: "知识库还是空的" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: "对 agent 说「把 XX 吸收进 wiki」开始沉淀。" })
				]
			});
			const groups = /* @__PURE__ */ new Map();
			for (const p of pages) {
				const list = groups.get(p.category) ?? [];
				list.push(p);
				groups.set(p.category, list);
			}
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-tree",
				children: [[...groups.entries()].map(([cat, list]) => {
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "knj-tree__group",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-tree__head",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "knj-tree__group-icon",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconBook, { size: 13 })
								}),
								CATEGORY_LABELS$1[cat] ?? cat,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "knj-tree__count",
									children: list.length
								})
							]
						}), list.map((p) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-tree__item",
							onClick: () => onOpen(p),
							title: p.title,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "knj-tree__item-icon",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconFile, { size: 13 })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "knj-tree__item-title",
									children: p.title
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `knj-dot ${CONFIDENCE_DOT[p.confidence] ?? "knj-dot--muted"}`,
									title: `confidence: ${p.confidence}`
								})
							]
						}, p.id))]
					}, cat);
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "knj-tree__hint",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconChevronRight, { size: 12 }), "点击笔记在右侧工作台打开"]
				})]
			});
		}
		//#endregion
		//#region src/client/SearchBox.tsx
		function SearchBox({ onResult }) {
			const [q, setQ] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [err, setErr] = (0, react.useState)(null);
			const run = async () => {
				if (!q.trim()) return;
				setBusy(true);
				setErr(null);
				try {
					onResult((await fetchSearch(q)).candidates);
				} catch {
					setErr("搜索失败，请重试");
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-search",
				style: { padding: "10px 12px 4px" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "knj-search__icon",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconSearch, { size: 14 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						className: "knj-input knj-search__input",
						value: q,
						onChange: (e) => {
							setQ(e.target.value);
							if (err) setErr(null);
						},
						onKeyDown: (e) => {
							if (e.key === "Enter") run();
						},
						placeholder: "搜索知识库…",
						spellCheck: false
					}),
					busy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "knj-search__spinner",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconRefresh, { size: 14 })
					}),
					!busy && q && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "knj-icon-btn knj-search__clear",
						title: "清空",
						onClick: () => setQ(""),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconClose, { size: 13 })
					}),
					err && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "knj-error",
						style: { padding: "6px 4px 0" },
						children: err
					})
				]
			});
		}
		//#endregion
		//#region src/client/LintPanel.tsx
		/**
		* v6/v7 底部状态条 + 展开面板（设计 v2）：
		* - 常驻：页数 + 健康状态点（绿/琥珀/红三态）
		* - 「问题」展开：断链 / 孤儿页 / 缺 frontmatter 逐条可点跳转
		* - 「工具」展开：重建索引 / 蒸馏近期会话 / 导入 md（原顶部工具条移入，释放主视觉）
		*/
		const CATEGORIES = [
			{
				value: "references",
				label: "参考"
			},
			{
				value: "concepts",
				label: "概念"
			},
			{
				value: "entities",
				label: "实体"
			},
			{
				value: "synthesis",
				label: "综合"
			},
			{
				value: "projects",
				label: "项目"
			},
			{
				value: "dictionaries",
				label: "字典"
			},
			{
				value: "tables",
				label: "数据结构"
			}
		];
		const DISTILL_TRIGGER = "用 wiki-distill 蒸馏近期 DSH 会话进知识库（先向我确认范围）";
		function LintPanel({ openNote }) {
			const [report, setReport] = (0, react.useState)(null);
			const [toolsOpen, setToolsOpen] = (0, react.useState)(false);
			const [issuesOpen, setIssuesOpen] = (0, react.useState)(false);
			const [catById, setCatById] = (0, react.useState)(/* @__PURE__ */ new Map());
			const [notice, setNotice] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(null);
			const [importPathInput, setImportPathInput] = (0, react.useState)("");
			const [importCategory, setImportCategory] = (0, react.useState)("references");
			const flash = (text, kind = "ok") => {
				setNotice({
					text,
					kind
				});
				setTimeout(() => setNotice(null), 5e3);
			};
			(0, react.useEffect)(() => {
				const load = () => {
					fetchLint().then(setReport).catch(() => {});
					fetchPages().then(({ pages }) => {
						const m = /* @__PURE__ */ new Map();
						for (const p of pages) m.set(p.id, {
							category: p.category,
							title: p.title
						});
						setCatById(m);
					}).catch(() => {});
				};
				load();
				window.addEventListener("wiki:pages-changed", load);
				return () => window.removeEventListener("wiki:pages-changed", load);
			}, []);
			const doRebuild = async () => {
				setBusy("rebuild");
				try {
					const r = await rebuildIndex();
					flash(`索引已重建（${r.pageCount} 页）`);
					window.dispatchEvent(new CustomEvent("wiki:pages-changed"));
				} catch (e) {
					flash(`重建失败：${e instanceof Error ? e.message : String(e)}`, "err");
				} finally {
					setBusy(null);
				}
			};
			const doImport = async () => {
				const p = importPathInput.trim();
				if (!p) {
					flash("请先填写 md 文件或目录路径", "err");
					return;
				}
				setBusy("import");
				try {
					const r = await importMd(p, importCategory);
					const parts = [
						r.imported ? `导入 ${r.imported}` : null,
						r.updated ? `更新 ${r.updated}` : null,
						r.skipped ? `跳过 ${r.skipped}` : null
					].filter(Boolean);
					flash(parts.length ? parts.join("，") : "没有可导入的文件");
					window.dispatchEvent(new CustomEvent("wiki:pages-changed"));
				} catch (e) {
					flash(`导入失败：${e instanceof Error ? e.message : String(e)}`, "err");
				} finally {
					setBusy(null);
				}
			};
			const doDistill = async () => {
				try {
					await navigator.clipboard.writeText(DISTILL_TRIGGER);
					flash("触发指令已复制，粘贴到对话发送即可");
				} catch {
					flash(`复制失败，请手动发送：${DISTILL_TRIGGER}`, "err");
				}
			};
			if (!report) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "knj-statusbar",
				style: { visibility: "hidden" },
				children: "·"
			});
			const issues = report.orphans.length + report.brokenLinks.length + report.missingFrontmatter.length;
			const health = issues === 0 ? "ok" : issues < 5 ? "warn" : "err";
			const healthLabel = issues === 0 ? "健康" : `${issues} 个问题`;
			const jump = (id) => {
				const meta = catById.get(id);
				if (meta) openNote(id, meta.category, meta.title);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				toolsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "knj-pop",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-pop__row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "knj-btn knj-btn--subtle",
								disabled: busy === "rebuild",
								onClick: doRebuild,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconRefresh, { size: 14 }), busy === "rebuild" ? "重建中…" : "重建索引"]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "knj-btn knj-btn--subtle",
								onClick: doDistill,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconSparkles, { size: 14 }), "蒸馏近期会话"]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-pop__row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "knj-input",
									value: importPathInput,
									onChange: (e) => setImportPathInput(e.target.value),
									placeholder: "导入 md：文件或目录路径",
									spellCheck: false
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
									className: "knj-select",
									style: {
										width: 76,
										flexShrink: 0
									},
									value: importCategory,
									onChange: (e) => setImportCategory(e.target.value),
									title: "导入分类",
									children: CATEGORIES.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
										value: c.value,
										children: c.label
									}, c.value))
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "knj-btn knj-btn--primary",
									disabled: busy === "import",
									onClick: doImport,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconImport, { size: 14 }), busy === "import" ? "导入中…" : "导入"]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "knj-pop__hint",
							children: "重建索引会重新生成 index.md；蒸馏会把触发指令复制到剪贴板。"
						}),
						notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: `knj-banner ${notice.kind === "ok" ? "knj-banner--ok" : "knj-banner--err"}`,
							children: notice.text
						})
					]
				}),
				issuesOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "knj-pop",
					style: {
						maxHeight: 260,
						overflow: "auto"
					},
					children: [
						issues === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "knj-pop__hint",
							children: "没有待处理的问题，知识库很健康。"
						}),
						report.brokenLinks.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-section-title",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconLink, { size: 13 }),
								"断链（",
								report.brokenLinks.length,
								"）"
							]
						}), report.brokenLinks.map((b, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-issue-item",
							onClick: () => jump(b.from),
							title: `在来源页修复指向 ${b.target} 的链接`,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconLink, { size: 13 }),
								b.from,
								" ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: { color: "var(--knj-error)" },
									children: ["→ ", b.target]
								})
							]
						}, `bl-${i}`))] }),
						report.orphans.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-section-title",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconWarning, { size: 13 }),
								"孤儿页（",
								report.orphans.length,
								"）"
							]
						}), report.orphans.map((o) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "knj-issue-item",
							onClick: () => jump(o),
							title: "双向链接未织好",
							children: catById.get(o)?.title ?? o
						}, `or-${o}`))] }),
						report.missingFrontmatter.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-section-title",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconWarning, { size: 13 }),
								"缺 frontmatter（",
								report.missingFrontmatter.length,
								"）"
							]
						}), report.missingFrontmatter.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "knj-issue-item",
							onClick: () => jump(m),
							children: m
						}, `mf-${m}`))] })
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "knj-statusbar",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "knj-statusbar__meta",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `knj-dot knj-dot--${health}` }),
								report.pageCount,
								" 页 · ",
								healthLabel
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "knj-statusbar__spacer" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "knj-btn knj-btn--sm",
							onClick: () => setIssuesOpen(!issuesOpen),
							children: [
								issues > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "knj-badge knj-badge--danger",
									children: issues
								}),
								"问题",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconChevronDown, { size: 12 })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "knj-btn knj-btn--sm",
							onClick: () => setToolsOpen(!toolsOpen),
							children: ["工具", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconChevronDown, { size: 12 })]
						})
					]
				})
			] });
		}
		//#endregion
		//#region src/client/GraphView.tsx
		/**
		* 图谱视图（设计 v2）：力导向布局渲染进 <svg>。
		* - 节点按 category 着色（CSS 类 → 宿主令牌，浅/深主题自适应），孤儿灰色，断链红色虚线
		* - 顶部统计 + 图例 chips；点击节点回调 onOpenNote 打开笔记
		* - 安全：用户可控字段（id/title/category）进入 innerHTML 前一律经 esc() 转义
		*/
		const ESC_MAP = {
			"<": "&lt;",
			">": "&gt;",
			"&": "&amp;",
			"\"": "&quot;"
		};
		function esc(s) {
			return s.replace(/[<>&"]/g, (c) => ESC_MAP[c] ?? c);
		}
		/** category → 节点 CSS 类（颜色由 styles.ts 令牌驱动） */
		const CATEGORY_CLASS = {
			concepts: "knj-graph-node--concepts",
			entities: "knj-graph-node--entities",
			references: "knj-graph-node--references",
			synthesis: "knj-graph-node--synthesis",
			projects: "knj-graph-node--projects",
			dictionaries: "knj-graph-node--dictionaries",
			tables: "knj-graph-node--tables"
		};
		const CATEGORY_LABELS = {
			concepts: "概念",
			entities: "实体",
			references: "参考",
			synthesis: "综合",
			projects: "项目",
			dictionaries: "字典",
			tables: "数据结构"
		};
		function GraphView({ onOpenNote }) {
			const [graph, setGraph] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const svgRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				let cancelled = false;
				fetch("/api/obsidian-wiki/graph").then((r) => r.json()).then((d) => {
					if (!cancelled) setGraph(d);
				}).catch((e) => {
					if (!cancelled) setError(String(e));
				});
				return () => {
					cancelled = true;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!graph || !svgRef.current) return;
				const svg = svgRef.current;
				const W = 600, H = 400;
				const nodes = graph.nodes.map((n, i) => ({
					...n,
					x: W / 2 + Math.cos(i * 2.4) * 140,
					y: H / 2 + Math.sin(i * 2.4) * 140,
					vx: 0,
					vy: 0
				}));
				const byId = new Map(nodes.map((n) => [n.id, n]));
				const edges = graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => ({
					...e,
					a: byId.get(e.source),
					b: byId.get(e.target)
				}));
				const orphans = new Set(graph.orphanIds);
				let frame = 0;
				let raf = 0;
				const DEG = .85, REP = 1200, SPRING = .04, TARGET = 120;
				const tick = () => {
					for (const a of nodes) {
						a.vx *= DEG;
						a.vy *= DEG;
						for (const b of nodes) {
							if (a === b) continue;
							const dx = a.x - b.x, dy = a.y - b.y;
							const d2 = dx * dx + dy * dy + .01;
							const d = Math.sqrt(d2);
							const f = REP / d2;
							a.vx += dx / d * f;
							a.vy += dy / d * f;
						}
					}
					for (const e of edges) {
						const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
						const d = Math.sqrt(dx * dx + dy * dy) || 1;
						const f = (d - TARGET) * SPRING;
						e.a.vx += dx / d * f;
						e.a.vy += dy / d * f;
						e.b.vx -= dx / d * f;
						e.b.vy -= dy / d * f;
					}
					for (const n of nodes) {
						n.x += n.vx;
						n.y += n.vy;
						n.x = Math.max(20, Math.min(580, n.x));
						n.y = Math.max(20, Math.min(380, n.y));
					}
					paint();
					frame++;
					if (frame < 200) raf = requestAnimationFrame(tick);
				};
				const paint = () => {
					let out = "";
					for (const e of edges) out += `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" class="knj-graph-edge${e.broken ? " knj-graph-edge--broken" : ""}" stroke-width="1.5"/>`;
					for (const n of nodes) {
						const cls = orphans.has(n.id) ? "knj-graph-node--orphan" : CATEGORY_CLASS[n.category] ?? "knj-graph-node--muted";
						out += `<g data-id="${esc(n.id)}" data-category="${esc(n.category)}" data-title="${esc(n.title)}" style="cursor:pointer">`;
						out += `<circle cx="${n.x}" cy="${n.y}" r="8" class="knj-graph-node ${cls}"/>`;
						out += `<text x="${n.x + 12}" y="${n.y + 4}" class="knj-graph-label">${esc(n.title)}</text>`;
						out += `</g>`;
					}
					svg.innerHTML = out;
				};
				const onClick = (ev) => {
					const el = ev.target.closest("g[data-id]");
					if (!el) return;
					onOpenNote(el.dataset.id, el.dataset.category, el.dataset.title);
				};
				svg.addEventListener("click", onClick);
				raf = requestAnimationFrame(tick);
				return () => {
					cancelAnimationFrame(raf);
					svg.removeEventListener("click", onClick);
				};
			}, [graph, onOpenNote]);
			if (error) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-error",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconRefresh, { size: 14 }),
					"图谱加载失败：",
					error
				]
			});
			if (!graph) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-loading",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "knj-spinner",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconRefresh, { size: 14 })
				}), "图谱加载中…"]
			});
			if (graph.nodes.length < 2) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-empty",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "knj-empty__icon",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconGraph, { size: 30 })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
						"图谱还太小（",
						graph.nodes.length,
						" 节点）"
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: "先吸收几份文档，图谱就会长出来。" })
				]
			});
			const legendKeys = [...new Set(graph.nodes.map((n) => n.category))];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-vcol",
				style: { padding: "4px 12px 12px" },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "knj-graph-head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "knj-graph-stats",
								children: [
									graph.nodes.length,
									" 节点 · ",
									graph.edges.length,
									" 边"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "knj-statusbar__spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "knj-pop__hint",
								children: "点击节点打开笔记"
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "knj-graph-legend",
						children: [legendKeys.map((cat) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `knj-chip knj-chip--${cat}`,
							children: CATEGORY_LABELS[cat] ?? cat
						}, cat)), graph.orphanIds.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "knj-chip knj-chip--neutral",
							children: ["孤儿 ", graph.orphanIds.length]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						ref: svgRef,
						width: 600,
						height: 400,
						viewBox: "0 0 600 400",
						className: "knj-graph-svg"
					})
				]
			});
		}
		//#endregion
		//#region src/client/VaultHeader.tsx
		/**
		* v7 vault 头部（设计 v2）：当前库身份（名称+路径）、切换下拉、新建/挂接/移除。
		* - 挂载时按当前工作区激活库（跟随工作区走；无 workspaces 服务时降级为手动切换）
		* - 切换/变更后回调 onVaultChanged，由上层刷新树/lint/图谱
		* 样式全部走宿主令牌（styles.ts），随宿主浅/深主题自适应。
		*/
		const SOURCE_LABEL = {
			cwd: "默认",
			workspace: "工作区",
			attached: "挂接"
		};
		function VaultHeader({ workspaces, onVaultChanged }) {
			const [current, setCurrent] = (0, react.useState)(null);
			const [vaults, setVaults] = (0, react.useState)([]);
			const [notice, setNotice] = (0, react.useState)(null);
			const [manageOpen, setManageOpen] = (0, react.useState)(false);
			const [formPath, setFormPath] = (0, react.useState)("");
			const [formName, setFormName] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const activatedRootRef = (0, react.useRef)(null);
			const flash = (text, kind = "ok") => {
				setNotice({
					text,
					kind
				});
				setTimeout(() => setNotice(null), 5e3);
			};
			const load = async () => {
				try {
					const r = await fetchVaults();
					setCurrent(r.current);
					setVaults(r.vaults);
				} catch (e) {
					flash(`库列表加载失败：${e instanceof Error ? e.message : String(e)}`, "err");
				}
			};
			(0, react.useEffect)(() => {
				load();
				if (!workspaces) return;
				let disposed = false;
				const applyWorkspace = () => {
					try {
						const snap = workspaces.list.getSnapshot();
						if (!snap.baselinesReady) return;
						const root = (snap.items.find((w) => w.id === snap.recentWorkspaceId) ?? snap.items[0])?.path;
						if (!root || disposed) return;
						if (activatedRootRef.current === root) return;
						activatedRootRef.current = root;
						activateVault(root).then((r) => {
							if (disposed) return;
							setCurrent(r.current);
							setVaults(r.vaults);
							onVaultChanged();
						}).catch(() => {});
					} catch {}
				};
				applyWorkspace();
				const unsub = workspaces.list.subscribe(applyWorkspace);
				return () => {
					disposed = true;
					unsub();
				};
			}, [workspaces]);
			const handleSwitch = async (id) => {
				if (!id || id === current?.id) return;
				setBusy(true);
				try {
					const r = await switchVault(id);
					setCurrent(r.current);
					setVaults(r.vaults);
					onVaultChanged();
				} catch (e) {
					flash(`切换失败：${e instanceof Error ? e.message : String(e)}`, "err");
				} finally {
					setBusy(false);
				}
			};
			const doAttach = async () => {
				const root = formPath.trim();
				if (!root) {
					flash("请填写库目录（绝对路径）", "err");
					return;
				}
				setBusy(true);
				try {
					const r = await attachVault(root, formName.trim() || void 0);
					setCurrent(r.current);
					setVaults(r.vaults);
					setManageOpen(false);
					setFormPath("");
					setFormName("");
					flash(`已挂接/新建：${r.current?.name ?? root}`);
					onVaultChanged();
				} catch (e) {
					flash(`挂接失败：${e instanceof Error ? e.message : String(e)}`, "err");
				} finally {
					setBusy(false);
				}
			};
			const doRemove = async () => {
				if (!current || current.source !== "attached") return;
				if (!window.confirm(`从列表中移除知识库「${current.name}」？\n不会删除磁盘上的任何文件。`)) return;
				setBusy(true);
				try {
					const r = await removeVault(current.id);
					setCurrent(r.current);
					setVaults(r.vaults);
					flash(`已移除「${current.name}」`);
					onVaultChanged();
				} catch (e) {
					flash(`移除失败：${e instanceof Error ? e.message : String(e)}`, "err");
				} finally {
					setBusy(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-vault",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "knj-vault__identity",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "knj-vault__name",
								title: current?.name,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconBook, { size: 15 }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "knj-vault__name-text",
									children: current ? current.name : "知识库"
								})]
							}),
							current && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "knj-vault__path",
								title: current.root,
								children: current.root
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "knj-statusbar__spacer" }),
							current?.source === "attached" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "knj-icon-btn knj-icon-btn--danger",
								title: "从列表移除（不删文件）",
								onClick: doRemove,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconTrash, { size: 14 })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "knj-icon-btn",
								title: "新建 / 挂接 / 移除知识库",
								onClick: () => setManageOpen(!manageOpen),
								children: manageOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconChevronDown, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconGear, { size: 14 })
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
						className: "knj-select knj-vault__select",
						value: current?.id ?? "",
						onChange: (e) => handleSwitch(e.target.value),
						disabled: busy,
						title: "切换知识库",
						children: [vaults.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
							value: "",
							children: "（无知识库）"
						}), vaults.map((v) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
							value: v.id,
							children: [
								v.name,
								" · ",
								v.pageCount,
								" 页 · ",
								SOURCE_LABEL[v.source] ?? v.source
							]
						}, v.id))]
					}),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: `knj-banner ${notice.kind === "ok" ? "knj-banner--ok" : "knj-banner--err"}`,
						style: { marginTop: 8 },
						children: notice.text
					}),
					manageOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "knj-vault__manage",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-vault__manage-row",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "knj-input",
								value: formPath,
								onChange: (e) => setFormPath(e.target.value),
								placeholder: "库目录（绝对路径）",
								spellCheck: false
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "knj-btn",
								onClick: () => workspaces?.pickDirectory?.().then((p) => p && setFormPath(p)).catch(() => {}),
								children: "选目录"
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-vault__manage-row",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: "knj-input",
									value: formName,
									onChange: (e) => setFormName(e.target.value),
									placeholder: "显示名（可留空）"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "knj-btn knj-btn--primary",
									disabled: busy || !formPath.trim(),
									onClick: doAttach,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconPlus, { size: 14 }), busy ? "处理中…" : "新建/挂接"]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "knj-btn",
									onClick: () => setManageOpen(false),
									children: "取消"
								})
							]
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/WikiSidebar.tsx
		/**
		* 知识库边栏标签（设计 v2）：
		* - 顶部：vault 头部（当前库身份 + 切换 + 新建/挂接/移除，v7）
		* - 搜索（图标输入框 + 加载态）
		* - 浏览/图谱分段切换；内容区随搜索结果 / 树 / 图谱切换
		* - 底部状态条（LintPanel）：页数 + 健康度；「问题」「工具」面板展开
		*/
		function WikiSidebar({ openNote, workspaces }) {
			const [results, setResults] = (0, react.useState)(null);
			const [view, setView] = (0, react.useState)("browse");
			const [vaultVersion, setVaultVersion] = (0, react.useState)(0);
			/** v7：库切换后清掉旧库的搜索结果、刷新树/lint、重挂载图谱。 */
			const handleVaultChanged = () => {
				setResults(null);
				setVaultVersion((v) => v + 1);
				window.dispatchEvent(new CustomEvent("wiki:pages-changed"));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-wiki knj-vcol",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(VaultHeader, {
						workspaces,
						onVaultChanged: handleVaultChanged
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchBox, { onResult: setResults }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: { padding: "8px 12px 4px" },
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-seg",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: `knj-seg__item${view === "browse" ? " knj-seg__item--active" : ""}`,
								onClick: () => setView("browse"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconBook, { size: 13 }), "浏览"]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: `knj-seg__item${view === "graph" ? " knj-seg__item--active" : ""}`,
								onClick: () => setView("graph"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconGraph, { size: 13 }), "图谱"]
							})]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "knj-grow knj-scroll",
						children: view === "graph" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GraphView, { onOpenNote: openNote }) }, vaultVersion) : results !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-vcol",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "knj-result-head",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: "knj-result-title",
											children: [
												"搜索结果（",
												results.length,
												"）"
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "knj-statusbar__spacer" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "knj-icon-btn",
											title: "返回浏览",
											onClick: () => setResults(null),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconClose, { size: 14 })
										})
									]
								}),
								results.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "knj-empty",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "knj-empty__icon",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconBook, { size: 26 })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: "没有匹配的笔记" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: "换个关键词试试，或对 agent 说「把 XX 吸收进 wiki」。" })
									]
								}),
								results.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "knj-result-item",
									onClick: () => openNote(c.id, c.category, c.title),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												fontSize: 13,
												fontWeight: 500,
												color: "var(--knj-text)"
											},
											children: c.title
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "knj-result-item__meta",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: `knj-chip knj-chip--${c.category}`,
												children: c.category
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: c.confidence })]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "knj-result-item__snippet",
											children: c.snippet
										})
									]
								}, c.id))
							]
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VaultTree, { onOpen: (p) => openNote(p.id, p.category, p.title) })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LintPanel, { openNote })
				]
			});
		}
		//#endregion
		//#region node_modules/marked/lib/marked.esm.js
		/**
		* marked v18.0.11 - a markdown parser
		* Copyright (c) 2018-2026, MarkedJS. (MIT License)
		* Copyright (c) 2011-2018, Christopher Jeffrey. (MIT License)
		* https://github.com/markedjs/marked
		*/
		/**
		* DO NOT EDIT THIS FILE
		* The code in this file is generated from files in ./src/
		*/
		function A() {
			return {
				async: !1,
				breaks: !1,
				extensions: null,
				gfm: !0,
				hooks: null,
				pedantic: !1,
				renderer: null,
				silent: !1,
				tokenizer: null,
				walkTokens: null
			};
		}
		var R = A();
		function j(l) {
			R = l;
		}
		var z = { exec: () => null };
		function I(l) {
			let e = [];
			return (t) => {
				let n = Math.max(0, Math.min(3, t - 1)), s = e[n];
				return s || (s = l(n), e[n] = s), s;
			};
		}
		function k(l, e = "") {
			let t = typeof l == "string" ? l : l.source, n = {
				replace: (s, r) => {
					let i = typeof r == "string" ? r : r.source;
					return i = i.replace(m.caret, "$1"), t = t.replace(s, i), n;
				},
				getRegex: () => new RegExp(t, e)
			};
			return n;
		}
		var Oe = ((l = "") => {
			try {
				return !!new RegExp("(?<=1)(?<!1)" + l);
			} catch {
				return !1;
			}
		})();
		var m = {
			codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm,
			outputLinkReplace: /\\([\[\]])/g,
			indentCodeCompensation: /^(\s+)(?:```)/,
			beginningSpace: /^\s+/,
			endingHash: /#$/,
			startingSpaceChar: /^ /,
			endingSpaceChar: / $/,
			nonSpaceChar: /[^ ]/,
			newLineCharGlobal: /\n/g,
			tabCharGlobal: /\t/g,
			multipleSpaceGlobal: /\s+/g,
			blankLine: /^[ \t]*$/,
			doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
			blockquoteStart: /^ {0,3}>/,
			blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g,
			blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
			listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
			listIsTask: /^\[[ xX]\] +\S/,
			listReplaceTask: /^\[[ xX]\] +/,
			listTaskCheckbox: /\[[ xX]\]/,
			anyLine: /\n.*\n/,
			hrefBrackets: /^<(.*)>$/,
			tableDelimiter: /[:|]/,
			tableAlignChars: /^\||\| *$/g,
			tableRowBlankLine: /\n[ \t]*$/,
			tableAlignRight: /^ *-+: *$/,
			tableAlignCenter: /^ *:-+: *$/,
			tableAlignLeft: /^ *:-+ *$/,
			startATag: /^<a /i,
			endATag: /^<\/a>/i,
			startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
			endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
			startAngleBracket: /^</,
			endAngleBracket: />$/,
			pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
			unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
			escapeTest: /[&<>"']/,
			escapeReplace: /[&<>"']/g,
			escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
			escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
			caret: /(^|[^\[])\^/g,
			percentDecode: /%25/g,
			findPipe: /\|/g,
			splitPipe: / \|/,
			slashPipe: /\\\|/g,
			carriageReturn: /\r\n|\r/g,
			spaceLine: /^ +$/gm,
			notSpaceStart: /^\S*/,
			endingNewline: /\n$/,
			listItemRegex: (l) => new RegExp(`^( {0,3}${l})((?:[	 ][^\\n]*)?(?:\\n|$))`),
			nextBulletRegex: I((l) => new RegExp(`^ {0,${l}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)),
			hrRegex: I((l) => new RegExp(`^ {0,${l}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`)),
			fencesBeginRegex: I((l) => new RegExp(`^ {0,${l}}(?:\`\`\`|~~~)`)),
			headingBeginRegex: I((l) => new RegExp(`^ {0,${l}}#`)),
			htmlBeginRegex: I((l) => new RegExp(`^ {0,${l}}<(?:[a-z].*>|!--)`, "i")),
			blockquoteBeginRegex: I((l) => new RegExp(`^ {0,${l}}>`))
		};
		var Te = /^(?:[ \t]*(?:\n|$))+/;
		var we = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
		var ye = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
		var q = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
		var Pe = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
		var U = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
		var oe = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
		var ae = k(oe).replace(/bull/g, U).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
		var Se = k(oe).replace(/bull/g, U).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
		var K = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
		var _e = /^[^\n]+/;
		var W = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
		var $e = k(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", W).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
		var Le = k(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, U).getRegex();
		var Q = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
		var X = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
		var Ee = k("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", X).replace("tag", Q).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
		var le = (l) => k(K).replace("hr", q).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", l).replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", Q).getRegex();
		var ze = le(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
		var Me = le(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
		var J = {
			blockquote: k(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", Me).getRegex(),
			code: we,
			def: $e,
			fences: ye,
			heading: Pe,
			hr: q,
			html: Ee,
			lheading: ae,
			list: Le,
			newline: Te,
			paragraph: ze,
			table: z,
			text: _e
		};
		var se = k("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", q).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", Q).getRegex();
		var Ie = {
			...J,
			lheading: Se,
			table: se,
			paragraph: k(K).replace("hr", q).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", se).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", Q).getRegex()
		};
		var Ce = {
			...J,
			html: k(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", X).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),
			def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
			heading: /^(#{1,6})(.*)(?:\n+|$)/,
			fences: z,
			lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
			paragraph: k(K).replace("hr", q).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", ae).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex()
		};
		var Be = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
		var De = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
		var ue = /^( {2,}|\\)\n(?!\s*$)/;
		var qe = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
		var _ = /[\p{P}\p{S}]/u;
		var C = /[\s\p{P}\p{S}]/u;
		var v = /[^\s\p{P}\p{S}]/u;
		var ve = k(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, C).getRegex();
		var He = /[\p{Pi}\p{Ps}"']/u;
		var pe = /(?!~)[\p{P}\p{S}]/u;
		var Ze = /(?!~)[\s\p{P}\p{S}]/u;
		var Ge = /(?:[^\s\p{P}\p{S}]|~)/u;
		var Qe = k(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", Oe ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
		var ce = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
		var Ne = k(ce, "u").replace(/punct/g, _).getRegex();
		var je = k(ce, "u").replace(/punct/g, pe).getRegex();
		var Ue = k(/^(?:\*+(?:((?!\*)(?!openQuote)punct)|([^\s*]))?)|^_+(?:((?!_)(?!openQuote)punct)|([^\s_]))?/, "u").replace(/openQuote/g, He).replace(/punct/g, _).getRegex();
		var he = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
		var Ke = k(he, "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, C).replace(/punct/g, _).getRegex();
		var We = k(he, "gu").replace(/notPunctSpace/g, Ge).replace(/punctSpace/g, Ze).replace(/punct/g, pe).getRegex();
		var Je = k("^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)[\\s](\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|(?:(?!\\*)punct|notPunctSpace)(\\*+)(?!\\*)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, C).replace(/punct/g, _).getRegex();
		var Ve = k("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, C).replace(/punct/g, _).getRegex();
		var et = k("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)[\\s](_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)|(?:(?!_)punct|notPunctSpace)(_+)(?!_)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, C).replace(/punct/g, _).getRegex();
		var tt = k(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, _).getRegex();
		var rt = k("^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, v).replace(/punctSpace/g, C).replace(/punct/g, _).getRegex();
		var st = k(/\\(punct)/, "gu").replace(/punct/g, _).getRegex();
		var it = k(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
		var ot = k(X).replace("(?:-->|$)", "-->").getRegex();
		var at = k("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", ot).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
		var G = /(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/;
		var lt = k(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?\s*\)/).replace("label", G).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
		var ke = k(/^!?\[(label)\]\[(ref)\]/).replace("label", G).replace("ref", W).getRegex();
		var de = k(/^!?\[(ref)\](?:\[\])?/).replace("ref", W).getRegex();
		var ut = k("reflink|nolink(?!\\()", "g").replace("reflink", ke).replace("nolink", de).getRegex();
		var ie = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
		var V = {
			_backpedal: z,
			anyPunctuation: st,
			autolink: it,
			blockSkip: Qe,
			br: ue,
			code: De,
			del: z,
			delLDelim: z,
			delRDelim: z,
			emStrongLDelim: Ne,
			emStrongRDelimAst: Ke,
			emStrongRDelimUnd: Ve,
			escape: Be,
			link: lt,
			nolink: de,
			punctuation: ve,
			reflink: ke,
			reflinkSearch: ut,
			tag: at,
			text: qe,
			url: z
		};
		var pt = {
			...V,
			emStrongLDelim: Ue,
			emStrongRDelimAst: Je,
			emStrongRDelimUnd: et,
			link: k(/^!?\[(label)\]\((.*?)\)/).replace("label", G).getRegex(),
			reflink: k(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", G).getRegex()
		};
		var F = {
			...V,
			emStrongRDelimAst: We,
			emStrongLDelim: je,
			delLDelim: tt,
			delRDelim: rt,
			url: k(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol", ie).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),
			_backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
			del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,
			text: k(/^(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol", ie).getRegex()
		};
		var ct = {
			...F,
			br: k(ue).replace("{2,}", "*").getRegex(),
			text: k(F.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex()
		};
		var H = {
			normal: J,
			gfm: Ie,
			pedantic: Ce
		};
		var B = {
			normal: V,
			gfm: F,
			breaks: ct,
			pedantic: pt
		};
		var ht = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			"\"": "&quot;",
			"'": "&#39;"
		};
		var ge = (l) => ht[l];
		function T(l, e) {
			if (e) {
				if (m.escapeTest.test(l)) return l.replace(m.escapeReplace, ge);
			} else if (m.escapeTestNoEncode.test(l)) return l.replace(m.escapeReplaceNoEncode, ge);
			return l;
		}
		function Y(l) {
			try {
				l = encodeURI(l).replace(m.percentDecode, "%");
			} catch {
				return null;
			}
			return l;
		}
		function ee(l, e) {
			let n = l.replace(m.findPipe, (r, i, o) => {
				let u = !1, a = i;
				for (; --a >= 0 && o[a] === "\\";) u = !u;
				return u ? "|" : " |";
			}).split(m.splitPipe), s = 0;
			if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
			else for (; n.length < e;) n.push("");
			for (; s < n.length; s++) n[s] = n[s].trim().replace(m.slashPipe, "|");
			return n;
		}
		function $(l, e, t) {
			let n = l.length;
			if (n === 0) return "";
			let s = 0;
			for (; s < n;) {
				let r = l.charAt(n - s - 1);
				if (r === e && !t) s++;
				else if (r !== e && t) s++;
				else break;
			}
			return l.slice(0, n - s);
		}
		function te(l) {
			let e = l.split(`
`), t = e.length - 1;
			for (; t >= 0 && m.blankLine.test(e[t]);) t--;
			return e.length - t <= 2 ? l : e.slice(0, t + 1).join(`
`);
		}
		function fe(l, e) {
			if (l.indexOf(e[1]) === -1) return -1;
			let t = 0;
			for (let n = 0; n < l.length; n++) if (l[n] === "\\") n++;
			else if (l[n] === e[0]) t++;
			else if (l[n] === e[1] && (t--, t < 0)) return n;
			return t > 0 ? -2 : -1;
		}
		function me(l, e = 0) {
			let t = e, n = "";
			for (let s of l) if (s === "	") {
				let r = 4 - t % 4;
				n += " ".repeat(r), t += r;
			} else n += s, t++;
			return n;
		}
		function xe(l, e, t, n, s) {
			let r = e.href, i = e.title || null, o = l[1].replace(s.other.outputLinkReplace, "$1"), u = l[0].charAt(0) === "!";
			n.state.inLink = !0;
			let a = n.state.linkEmitted, p = n.state.inRawBlock;
			n.state.linkEmitted = !1;
			let c = n.inlineTokens(o), h = n.state.linkEmitted;
			if (n.state.linkEmitted = a, n.state.inLink = !1, !u) {
				if (h) {
					n.state.inRawBlock = p;
					return;
				}
				n.state.linkEmitted = !0;
			}
			return {
				type: u ? "image" : "link",
				raw: t,
				href: r,
				title: i,
				text: o,
				tokens: c
			};
		}
		function kt(l, e, t) {
			let n = l.match(t.other.indentCodeCompensation);
			if (n === null) return e;
			let s = n[1];
			return e.split(`
`).map((r) => {
				let i = r.match(t.other.beginningSpace);
				if (i === null) return r;
				let [o] = i;
				return o.length >= s.length ? r.slice(s.length) : r;
			}).join(`
`);
		}
		var y = class {
			options;
			rules;
			lexer;
			constructor(e) {
				this.options = e || R;
			}
			space(e) {
				let t = this.rules.block.newline.exec(e);
				if (t && t[0].length > 0) return {
					type: "space",
					raw: t[0]
				};
			}
			code(e) {
				let t = this.rules.block.code.exec(e);
				if (t) {
					let n = this.options.pedantic ? t[0] : te(t[0]);
					return {
						type: "code",
						raw: n,
						codeBlockStyle: "indented",
						text: n.replace(this.rules.other.codeRemoveIndent, "")
					};
				}
			}
			fences(e) {
				let t = this.rules.block.fences.exec(e);
				if (t) {
					let n = t[0], s = kt(n, t[3] || "", this.rules);
					return {
						type: "code",
						raw: n,
						lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2],
						text: s
					};
				}
			}
			heading(e) {
				let t = this.rules.block.heading.exec(e);
				if (t) {
					let n = t[2].trim();
					if (this.rules.other.endingHash.test(n)) {
						let s = $(n, "#");
						(this.options.pedantic || !s || this.rules.other.endingSpaceChar.test(s)) && (n = s.trim());
					}
					return {
						type: "heading",
						raw: $(t[0], `
`),
						depth: t[1].length,
						text: n,
						tokens: this.lexer.inline(n)
					};
				}
			}
			hr(e) {
				let t = this.rules.block.hr.exec(e);
				if (t) return {
					type: "hr",
					raw: $(t[0], `
`)
				};
			}
			blockquote(e) {
				let t = this.rules.block.blockquote.exec(e);
				if (t) {
					let n = $(t[0], `
`).split(`
`), s = "", r = "", i = [];
					for (; n.length > 0;) {
						let o = !1, u = [], a;
						for (a = 0; a < n.length; a++) if (this.rules.other.blockquoteStart.test(n[a])) u.push(n[a]), o = !0;
						else if (!o) u.push(n[a]);
						else break;
						n = n.slice(a);
						let p = u.join(`
`), c = p.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
						s = s ? `${s}
${p}` : p, r = r ? `${r}
${c}` : c;
						let h = this.lexer.state.top;
						if (this.lexer.state.top = !0, this.lexer.blockTokens(c, i, !0), this.lexer.state.top = h, n.length === 0) break;
						let d = i.at(-1);
						if (d?.type === "code") break;
						if (d?.type === "blockquote") {
							let O = d, g = n.join(`
`), w = O.raw + `
` + g.replace(this.rules.other.blockquoteSetextReplace2, ""), E = this.blockquote(w);
							i[i.length - 1] = E, s = `${s}
${g}`, r = r.substring(0, r.length - O.text.length) + E.text;
							break;
						} else if (d?.type === "list") {
							let O = d, g = O.raw + `
` + n.join(`
`), w = this.list(g);
							i[i.length - 1] = w, s = s.substring(0, s.length - d.raw.length) + w.raw, r = r.substring(0, r.length - O.raw.length) + w.raw, n = g.substring(i.at(-1).raw.length).split(`
`);
							continue;
						}
					}
					return {
						type: "blockquote",
						raw: s,
						tokens: i,
						text: r
					};
				}
			}
			list(e) {
				let t = this.rules.block.list.exec(e);
				if (t) {
					let n = t[1].trim(), s = n.length > 1, r = {
						type: "list",
						raw: "",
						ordered: s,
						start: s ? +n.slice(0, -1) : "",
						loose: !1,
						items: []
					};
					n = s ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = s ? n : "[*+-]");
					let i = this.rules.other.listItemRegex(n), o = !1;
					for (; e;) {
						let a = !1, p = "", c = "";
						if (!(t = i.exec(e)) || this.rules.block.hr.test(e)) break;
						p = t[0], e = e.substring(p.length);
						let h = me(t[2].split(`
`, 1)[0], t[1].length), d = e.split(`
`, 1)[0], O = !h.trim(), g = 0;
						if (this.options.pedantic ? (g = 2, c = h.trimStart()) : O ? g = t[1].length + 1 : (g = h.search(this.rules.other.nonSpaceChar), g = g > 4 ? 1 : g, c = h.slice(g), g += t[1].length), O && this.rules.other.blankLine.test(d) && (p += d + `
`, e = e.substring(d.length + 1), a = !0), !a) {
							let w = this.rules.other.nextBulletRegex(g), E = this.rules.other.hrRegex(g), ne = this.rules.other.fencesBeginRegex(g), re = this.rules.other.headingBeginRegex(g), be = this.rules.other.htmlBeginRegex(g), Re = this.rules.other.blockquoteBeginRegex(g);
							for (; e;) {
								let N = e.split(`
`, 1)[0], D;
								if (d = N, this.options.pedantic ? (d = d.replace(this.rules.other.listReplaceNesting, "  "), D = d) : D = d.replace(this.rules.other.tabCharGlobal, "    "), ne.test(d) || re.test(d) || be.test(d) || Re.test(d) || w.test(d) || E.test(d)) break;
								if (D.search(this.rules.other.nonSpaceChar) >= g || !d.trim()) c += `
` + D.slice(g);
								else {
									if (O || h.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || ne.test(h) || re.test(h) || E.test(h)) break;
									c += `
` + d;
								}
								O = !d.trim(), p += N + `
`, e = e.substring(N.length + 1), h = D.slice(g);
							}
						}
						r.loose || (o ? r.loose = !0 : this.rules.other.doubleBlankLine.test(p) && (o = !0)), r.items.push({
							type: "list_item",
							raw: p,
							task: !!this.options.gfm && this.rules.other.listIsTask.test(c),
							loose: !1,
							text: c,
							tokens: []
						}), r.raw += p;
					}
					let u = r.items.at(-1);
					if (u) u.raw = u.raw.trimEnd(), u.text = u.text.trimEnd();
					else return;
					r.raw = r.raw.trimEnd();
					for (let a of r.items) if (this.lexer.state.top = !1, a.tokens = this.lexer.blockTokens(a.text, []), !r.loose) {
						let p = a.tokens.filter((h) => h.type === "space");
						r.loose = p.length > 0 && p.some((h) => this.rules.other.anyLine.test(h.raw));
					}
					for (let a of r.items) {
						let p = a.tokens[0];
						if (a.task && (p?.type === "text" || p?.type === "paragraph")) {
							a.text = a.text.replace(this.rules.other.listReplaceTask, ""), p.raw = p.raw.replace(this.rules.other.listReplaceTask, ""), p.text = p.text.replace(this.rules.other.listReplaceTask, "");
							for (let h = this.lexer.inlineQueue.length - 1; h >= 0; h--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[h].src)) {
								this.lexer.inlineQueue[h].src = this.lexer.inlineQueue[h].src.replace(this.rules.other.listReplaceTask, "");
								break;
							}
							let c = this.rules.other.listTaskCheckbox.exec(a.raw);
							if (c) {
								let h = {
									type: "checkbox",
									raw: c[0] + " ",
									checked: c[0] !== "[ ]"
								};
								a.checked = h.checked, r.loose ? a.tokens[0] && ["paragraph", "text"].includes(a.tokens[0].type) && "tokens" in a.tokens[0] && a.tokens[0].tokens ? (a.tokens[0].raw = h.raw + a.tokens[0].raw, a.tokens[0].text = h.raw + a.tokens[0].text, a.tokens[0].tokens.unshift(h)) : a.tokens.unshift({
									type: "paragraph",
									raw: h.raw,
									text: h.raw,
									tokens: [h]
								}) : a.tokens.unshift(h);
							}
						} else a.task && (a.task = !1);
					}
					if (r.loose) for (let a of r.items) {
						a.loose = !0;
						for (let p of a.tokens) p.type === "text" && (p.type = "paragraph");
					}
					return r;
				}
			}
			html(e) {
				let t = this.rules.block.html.exec(e);
				if (t) {
					let n = te(t[0]);
					return {
						type: "html",
						block: !0,
						raw: n,
						pre: t[1] === "pre" || t[1] === "script" || t[1] === "style",
						text: n
					};
				}
			}
			def(e) {
				let t = this.rules.block.def.exec(e);
				if (t) {
					let n = t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, " "), s = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
					return {
						type: "def",
						tag: n,
						raw: $(t[0], `
`),
						href: s,
						title: r
					};
				}
			}
			table(e) {
				let t = this.rules.block.table.exec(e);
				if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
				let n = ee(t[1]), s = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], i = {
					type: "table",
					raw: $(t[0], `
`),
					header: [],
					align: [],
					rows: []
				};
				if (n.length === s.length) {
					for (let o of s) this.rules.other.tableAlignRight.test(o) ? i.align.push("right") : this.rules.other.tableAlignCenter.test(o) ? i.align.push("center") : this.rules.other.tableAlignLeft.test(o) ? i.align.push("left") : i.align.push(null);
					for (let o = 0; o < n.length; o++) i.header.push({
						text: n[o],
						tokens: this.lexer.inline(n[o]),
						header: !0,
						align: i.align[o]
					});
					for (let o of r) i.rows.push(ee(o, i.header.length).map((u, a) => ({
						text: u,
						tokens: this.lexer.inline(u),
						header: !1,
						align: i.align[a]
					})));
					return i;
				}
			}
			lheading(e) {
				let t = this.rules.block.lheading.exec(e);
				if (t) {
					let n = t[1].trim();
					return {
						type: "heading",
						raw: $(t[0], `
`),
						depth: t[2].charAt(0) === "=" ? 1 : 2,
						text: n,
						tokens: this.lexer.inline(n)
					};
				}
			}
			paragraph(e) {
				let t = this.rules.block.paragraph.exec(e);
				if (t) {
					let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
					return {
						type: "paragraph",
						raw: t[0],
						text: n,
						tokens: this.lexer.inline(n)
					};
				}
			}
			text(e) {
				let t = this.rules.block.text.exec(e);
				if (t) return {
					type: "text",
					raw: t[0],
					text: t[0],
					tokens: this.lexer.inline(t[0])
				};
			}
			escape(e) {
				let t = this.rules.inline.escape.exec(e);
				if (t) return {
					type: "escape",
					raw: t[0],
					text: t[1]
				};
			}
			tag(e) {
				let t = this.rules.inline.tag.exec(e);
				if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = !0 : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = !1), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = !0 : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = !1), {
					type: "html",
					raw: t[0],
					inLink: this.lexer.state.inLink,
					inRawBlock: this.lexer.state.inRawBlock,
					block: !1,
					text: t[0]
				};
			}
			link(e) {
				let t = this.rules.inline.link.exec(e);
				if (t) {
					let n = t[2].trim();
					if (!this.options.pedantic && this.rules.other.startAngleBracket.test(n)) {
						if (!this.rules.other.endAngleBracket.test(n)) return;
						let i = $(n.slice(0, -1), "\\");
						if ((n.length - i.length) % 2 === 0) return;
					} else {
						let i = fe(t[2], "()");
						if (i === -2) return;
						if (i > -1) {
							let u = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + i;
							t[2] = t[2].substring(0, i), t[0] = t[0].substring(0, u).trim(), t[3] = "";
						}
					}
					let s = t[2], r = "";
					if (this.options.pedantic) {
						let i = this.rules.other.pedanticHrefTitle.exec(s);
						i && (s = i[1], r = i[3]);
					} else r = t[3] ? t[3].slice(1, -1) : "";
					return s = s.trim(), this.rules.other.startAngleBracket.test(s) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(n) ? s = s.slice(1) : s = s.slice(1, -1)), xe(t, {
						href: s && s.replace(this.rules.inline.anyPunctuation, "$1"),
						title: r && r.replace(this.rules.inline.anyPunctuation, "$1")
					}, t[0], this.lexer, this.rules);
				}
			}
			reflink(e, t) {
				let n;
				if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
					let r = t[(n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " ").toLowerCase()];
					if (!r) {
						let i = n[0].charAt(0);
						return {
							type: "text",
							raw: i,
							text: i
						};
					}
					return xe(n, r, n[0], this.lexer, this.rules);
				}
			}
			emStrong(e, t, n = "") {
				let s = this.rules.inline.emStrongLDelim.exec(e);
				if (!s || !s[1] && !s[2] && !s[3] && !s[4] || s[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
				if (!(s[1] || s[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
					let i = [...s[0]].length - 1, o, u, a = i, p = 0, c = s[0][0], h = n === c, d = c === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
					for (d.lastIndex = 0, t = t.slice(-1 * e.length + i); (s = d.exec(t)) !== null;) {
						if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o) continue;
						if (u = [...o].length, s[3] || s[4]) {
							a += u;
							continue;
						} else if (s[5] || s[6]) {
							if (i % 3 && !((i + u) % 3)) {
								p += u;
								continue;
							}
							if (h) break;
						}
						if (a -= u, a > 0) continue;
						u = Math.min(u, u + a + p);
						let O = [...s[0]][0].length, g = e.slice(0, i + s.index + O + u);
						if (Math.min(i, u) % 2) {
							let E = g.slice(1, -1);
							return {
								type: "em",
								raw: g,
								text: E,
								tokens: this.lexer.inlineTokens(E)
							};
						}
						let w = g.slice(2, -2);
						return {
							type: "strong",
							raw: g,
							text: w,
							tokens: this.lexer.inlineTokens(w)
						};
					}
				}
			}
			codespan(e) {
				let t = this.rules.inline.code.exec(e);
				if (t) {
					let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), s = this.rules.other.nonSpaceChar.test(n), r = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
					return s && r && (n = n.substring(1, n.length - 1)), {
						type: "codespan",
						raw: t[0],
						text: n
					};
				}
			}
			br(e) {
				let t = this.rules.inline.br.exec(e);
				if (t) return {
					type: "br",
					raw: t[0]
				};
			}
			del(e, t, n = "") {
				let s = this.rules.inline.delLDelim.exec(e);
				if (!s) return;
				if (!(s[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
					let i = [...s[0]].length - 1, o, u, a = i, p = this.rules.inline.delRDelim;
					for (p.lastIndex = 0, t = t.slice(-1 * e.length + i); (s = p.exec(t)) !== null;) {
						if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o || (u = [...o].length, u !== i)) continue;
						if (s[3] || s[4]) {
							a += u;
							continue;
						}
						if (a -= u, a > 0) continue;
						u = Math.min(u, u + a);
						let c = [...s[0]][0].length, h = e.slice(0, i + s.index + c + u), d = h.slice(i, -i);
						return {
							type: "del",
							raw: h,
							text: d,
							tokens: this.lexer.inlineTokens(d)
						};
					}
				}
			}
			autolink(e) {
				let t = this.rules.inline.autolink.exec(e);
				if (t) {
					let n, s;
					return t[2] === "@" ? (n = t[1], s = "mailto:" + n) : (n = t[1], s = n), {
						type: "link",
						raw: t[0],
						text: n,
						href: s,
						tokens: [{
							type: "text",
							raw: n,
							text: n
						}]
					};
				}
			}
			url(e) {
				let t;
				if (t = this.rules.inline.url.exec(e)) {
					let n, s;
					if (t[2] === "@") n = t[0], s = "mailto:" + n;
					else {
						let r;
						do
							r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
						while (r !== t[0]);
						n = t[0], t[1] === "www." ? s = "http://" + t[0] : s = t[0];
					}
					return {
						type: "link",
						raw: t[0],
						text: n,
						href: s,
						tokens: [{
							type: "text",
							raw: n,
							text: n
						}]
					};
				}
			}
			inlineText(e) {
				let t = this.rules.inline.text.exec(e);
				if (t) {
					let n = this.lexer.state.inRawBlock;
					return {
						type: "text",
						raw: t[0],
						text: t[0],
						escaped: n
					};
				}
			}
		};
		var x = class l {
			tokens;
			options;
			state;
			inlineQueue;
			tokenizer;
			constructor(e) {
				this.tokens = [], this.tokens.links = Object.create(null), this.options = e || R, this.options.tokenizer = this.options.tokenizer || new y(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = {
					inLink: !1,
					inRawBlock: !1,
					linkEmitted: !1,
					top: !0
				};
				let t = {
					other: m,
					block: H.normal,
					inline: B.normal
				};
				this.options.pedantic ? (t.block = H.pedantic, t.inline = B.pedantic) : this.options.gfm && (t.block = H.gfm, this.options.breaks ? t.inline = B.breaks : t.inline = B.gfm), this.tokenizer.rules = t;
			}
			static get rules() {
				return {
					block: H,
					inline: B
				};
			}
			static lex(e, t) {
				return new l(t).lex(e);
			}
			static lexInline(e, t) {
				return new l(t).inlineTokens(e);
			}
			lex(e) {
				e = e.replace(m.carriageReturn, `
`), this.blockTokens(e, this.tokens);
				for (let t = 0; t < this.inlineQueue.length; t++) {
					let n = this.inlineQueue[t];
					this.inlineTokens(n.src, n.tokens);
				}
				return this.inlineQueue = [], this.tokens;
			}
			blockTokens(e, t = [], n = !1) {
				this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(m.tabCharGlobal, "    ").replace(m.spaceLine, ""));
				let s = 1 / 0;
				for (; e;) {
					if (e.length < s) s = e.length;
					else {
						this.infiniteLoopError(e.charCodeAt(0));
						break;
					}
					let r;
					if (this.options.extensions?.block?.some((o) => (r = o.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), !0) : !1)) continue;
					if (r = this.tokenizer.space(e)) {
						e = e.substring(r.raw.length);
						let o = t.at(-1);
						r.raw.length === 1 && o !== void 0 ? o.raw += `
` : t.push(r);
						continue;
					}
					if (r = this.tokenizer.code(e)) {
						e = e.substring(r.raw.length);
						let o = t.at(-1);
						o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.at(-1).src = o.text) : t.push(r);
						continue;
					}
					if (r = this.tokenizer.fences(e)) {
						e = e.substring(r.raw.length), t.push(r);
						continue;
					}
					if (r = this.tokenizer.heading(e)) {
						e = e.substring(r.raw.length), t.push(r);
						continue;
					}
					if (r = this.tokenizer.hr(e)) {
						e = e.substring(r.raw.length), t.push(r);
						continue;
					}
					if (r = this.tokenizer.blockquote(e)) {
						e = e.substring(r.raw.length), t.push(r);
						continue;
					}
					if (r = this.tokenizer.list(e)) {
						e = e.substring(r.raw.length), t.push(r);
						continue;
					}
					if (r = this.tokenizer.html(e)) {
						e = e.substring(r.raw.length), t.push(r);
						continue;
					}
					if (r = this.tokenizer.def(e)) {
						e = e.substring(r.raw.length);
						let o = t.at(-1);
						o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.raw, this.inlineQueue.at(-1).src = o.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = {
							href: r.href,
							title: r.title
						}, t.push(r));
						continue;
					}
					if (r = this.tokenizer.table(e)) {
						e = e.substring(r.raw.length), t.push(r);
						continue;
					}
					if (r = this.tokenizer.lheading(e)) {
						e = e.substring(r.raw.length), t.push(r);
						continue;
					}
					let i = e;
					if (this.options.extensions?.startBlock) {
						let o = 1 / 0, u = e.slice(1), a;
						this.options.extensions.startBlock.forEach((p) => {
							a = p.call({ lexer: this }, u), typeof a == "number" && a >= 0 && (o = Math.min(o, a));
						}), o < 1 / 0 && o >= 0 && (i = e.substring(0, o + 1));
					}
					if (this.state.top && (r = this.tokenizer.paragraph(i))) {
						let o = t.at(-1);
						n && o?.type === "paragraph" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r), n = i.length !== e.length, e = e.substring(r.raw.length);
						continue;
					}
					if (r = this.tokenizer.text(e)) {
						e = e.substring(r.raw.length);
						let o = t.at(-1);
						o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r);
						continue;
					}
					if (e) {
						this.infiniteLoopError(e.charCodeAt(0));
						break;
					}
				}
				return this.state.top = !0, t;
			}
			inline(e, t = []) {
				return this.inlineQueue.push({
					src: e,
					tokens: t
				}), t;
			}
			linkInText(e) {
				if (!e.includes("[")) return !1;
				let t = this.tokenizer.rules.inline.link;
				for (let n of e.matchAll(this.tokenizer.rules.inline.blockSkip)) if (t.test(n[0]) && e.charAt(n.index - 1) !== "!") return !0;
				for (let n of e.matchAll(this.tokenizer.rules.inline.reflinkSearch)) {
					let s = n[0], r = s.lastIndexOf("[");
					if (!(s.charAt(0) === "!" || !Object.hasOwn(this.tokens.links, s.slice(r + 1, -1))) && !(r > 1 && this.linkInText(s.slice(1, r - 1)))) return !0;
				}
				return !1;
			}
			inlineTokens(e, t = []) {
				this.tokenizer.lexer = this;
				let n = e;
				if (this.tokens.links && e.includes("[")) {
					let o = this.tokenizer.rules.inline.reflinkSearch, u = (a) => {
						let p = a.lastIndexOf("[");
						if (!Object.hasOwn(this.tokens.links, a.slice(p + 1, -1))) return a;
						if (p > 1 && a.charAt(0) !== "!") {
							let c = a.slice(1, p - 1);
							if (this.linkInText(c)) return "[" + c.replace(o, u) + "][" + "a".repeat(a.length - p - 2) + "]";
						}
						return "[" + "a".repeat(a.length - 2) + "]";
					};
					n = n.replace(o, u);
				}
				n = n.replace(this.tokenizer.rules.inline.anyPunctuation, (o) => "+".repeat(o.length)), n = n.replace(this.tokenizer.rules.inline.blockSkip, (o, u, a) => {
					let p = a ? a.length : 0;
					return o.slice(0, p) + "[" + "a".repeat(o.length - p - 2) + "]";
				}), n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
				let s = !1, r = "", i = 1 / 0;
				for (; e;) {
					if (e.length < i) i = e.length;
					else {
						this.infiniteLoopError(e.charCodeAt(0));
						break;
					}
					s || (r = ""), s = !1;
					let o;
					if (this.options.extensions?.inline?.some((a) => (o = a.call({ lexer: this }, e, t)) ? (e = e.substring(o.raw.length), t.push(o), !0) : !1)) continue;
					if (o = this.tokenizer.escape(e)) {
						e = e.substring(o.raw.length), t.push(o);
						continue;
					}
					if (o = this.tokenizer.tag(e)) {
						e = e.substring(o.raw.length), t.push(o);
						continue;
					}
					if (o = this.tokenizer.link(e)) {
						e = e.substring(o.raw.length), t.push(o);
						continue;
					}
					if (o = this.tokenizer.reflink(e, this.tokens.links)) {
						e = e.substring(o.raw.length);
						let a = t.at(-1);
						o.type === "text" && a?.type === "text" ? (a.raw += o.raw, a.text += o.text) : t.push(o);
						continue;
					}
					if (o = this.tokenizer.emStrong(e, n, r)) {
						e = e.substring(o.raw.length), t.push(o);
						continue;
					}
					if (o = this.tokenizer.codespan(e)) {
						e = e.substring(o.raw.length), t.push(o);
						continue;
					}
					if (o = this.tokenizer.br(e)) {
						e = e.substring(o.raw.length), t.push(o);
						continue;
					}
					if (o = this.tokenizer.del(e, n, r)) {
						e = e.substring(o.raw.length), t.push(o);
						continue;
					}
					if (o = this.tokenizer.autolink(e)) {
						e = e.substring(o.raw.length), t.push(o);
						continue;
					}
					if (!this.state.inLink && (o = this.tokenizer.url(e))) {
						e = e.substring(o.raw.length), t.push(o);
						continue;
					}
					let u = e;
					if (this.options.extensions?.startInline) {
						let a = 1 / 0, p = e.slice(1), c;
						this.options.extensions.startInline.forEach((h) => {
							c = h.call({ lexer: this }, p), typeof c == "number" && c >= 0 && (a = Math.min(a, c));
						}), a < 1 / 0 && a >= 0 && (u = e.substring(0, a + 1));
					}
					if (o = this.tokenizer.inlineText(u)) {
						e = e.substring(o.raw.length), o.raw.slice(-1) !== "_" && (r = o.raw.slice(-1)), s = !0;
						let a = t.at(-1);
						a?.type === "text" ? (a.raw += o.raw, a.text += o.text) : t.push(o);
						continue;
					}
					if (e) {
						this.infiniteLoopError(e.charCodeAt(0));
						break;
					}
				}
				return t;
			}
			infiniteLoopError(e) {
				let t = "Infinite loop on byte: " + e;
				if (this.options.silent) console.error(t);
				else throw new Error(t);
			}
		};
		var P = class {
			options;
			parser;
			constructor(e) {
				this.options = e || R;
			}
			space(e) {
				return "";
			}
			code({ text: e, lang: t, escaped: n }) {
				let s = (t || "").match(m.notSpaceStart)?.[0], r = e.replace(m.endingNewline, "") + `
`;
				return s ? "<pre><code class=\"language-" + T(s) + "\">" + (n ? r : T(r, !0)) + `</code></pre>
` : "<pre><code>" + (n ? r : T(r, !0)) + `</code></pre>
`;
			}
			blockquote({ tokens: e }) {
				return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
			}
			html({ text: e }) {
				return e;
			}
			def(e) {
				return "";
			}
			heading({ tokens: e, depth: t }) {
				return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
			}
			hr(e) {
				return `<hr>
`;
			}
			list(e) {
				let t = e.ordered, n = e.start, s = "";
				for (let o = 0; o < e.items.length; o++) {
					let u = e.items[o];
					s += this.listitem(u);
				}
				let r = t ? "ol" : "ul", i = t && n !== 1 ? " start=\"" + n + "\"" : "";
				return "<" + r + i + `>
` + s + "</" + r + `>
`;
			}
			listitem(e) {
				return `<li>${this.parser.parse(e.tokens)}</li>
`;
			}
			checkbox({ checked: e }) {
				return "<input " + (e ? "checked=\"\" " : "") + "disabled=\"\" type=\"checkbox\"> ";
			}
			paragraph({ tokens: e }) {
				return `<p>${this.parser.parseInline(e)}</p>
`;
			}
			table(e) {
				let t = "", n = "";
				for (let r = 0; r < e.header.length; r++) n += this.tablecell(e.header[r]);
				t += this.tablerow({ text: n });
				let s = "";
				for (let r = 0; r < e.rows.length; r++) {
					let i = e.rows[r];
					n = "";
					for (let o = 0; o < i.length; o++) n += this.tablecell(i[o]);
					s += this.tablerow({ text: n });
				}
				return s && (s = `<tbody>${s}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + s + `</table>
`;
			}
			tablerow({ text: e }) {
				return `<tr>
${e}</tr>
`;
			}
			tablecell(e) {
				let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
				return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
			}
			strong({ tokens: e }) {
				return `<strong>${this.parser.parseInline(e)}</strong>`;
			}
			em({ tokens: e }) {
				return `<em>${this.parser.parseInline(e)}</em>`;
			}
			codespan({ text: e }) {
				return `<code>${T(e, !0)}</code>`;
			}
			br(e) {
				return "<br>";
			}
			del({ tokens: e }) {
				return `<del>${this.parser.parseInline(e)}</del>`;
			}
			link({ href: e, title: t, tokens: n }) {
				let s = this.parser.parseInline(n), r = Y(e);
				if (r === null) return s;
				e = r;
				let i = "<a href=\"" + e + "\"";
				return t && (i += " title=\"" + T(t) + "\""), i += ">" + s + "</a>", i;
			}
			image({ href: e, title: t, text: n, tokens: s }) {
				s && (n = this.parser.parseInline(s, this.parser.textRenderer));
				let r = Y(e);
				if (r === null) return T(n);
				e = r;
				let i = `<img src="${e}" alt="${T(n)}"`;
				return t && (i += ` title="${T(t)}"`), i += ">", i;
			}
			text(e) {
				return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : T(e.text);
			}
		};
		var L = class {
			strong({ text: e }) {
				return e;
			}
			em({ text: e }) {
				return e;
			}
			codespan({ text: e }) {
				return e;
			}
			del({ text: e }) {
				return e;
			}
			html({ text: e }) {
				return e;
			}
			text({ text: e }) {
				return e;
			}
			link({ text: e }) {
				return "" + e;
			}
			image({ text: e }) {
				return "" + e;
			}
			br() {
				return "";
			}
			checkbox({ raw: e }) {
				return e;
			}
		};
		var b = class l {
			options;
			renderer;
			textRenderer;
			constructor(e) {
				this.options = e || R, this.options.renderer = this.options.renderer || new P(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new L();
			}
			static parse(e, t) {
				return new l(t).parse(e);
			}
			static parseInline(e, t) {
				return new l(t).parseInline(e);
			}
			parse(e) {
				this.renderer.parser = this;
				let t = "";
				for (let n = 0; n < e.length; n++) {
					let s = e[n];
					if (this.options.extensions?.renderers?.[s.type]) {
						let i = s, o = this.options.extensions.renderers[i.type].call({ parser: this }, i);
						if (o !== !1 || ![
							"space",
							"hr",
							"heading",
							"code",
							"table",
							"blockquote",
							"list",
							"checkbox",
							"html",
							"def",
							"paragraph",
							"text"
						].includes(i.type)) {
							t += o || "";
							continue;
						}
					}
					let r = s;
					switch (r.type) {
						case "space":
							t += this.renderer.space(r);
							break;
						case "hr":
							t += this.renderer.hr(r);
							break;
						case "heading":
							t += this.renderer.heading(r);
							break;
						case "code":
							t += this.renderer.code(r);
							break;
						case "table":
							t += this.renderer.table(r);
							break;
						case "blockquote":
							t += this.renderer.blockquote(r);
							break;
						case "list":
							t += this.renderer.list(r);
							break;
						case "checkbox":
							t += this.renderer.checkbox(r);
							break;
						case "html":
							t += this.renderer.html(r);
							break;
						case "def":
							t += this.renderer.def(r);
							break;
						case "paragraph":
							t += this.renderer.paragraph(r);
							break;
						case "text":
							t += this.renderer.text(r);
							break;
						default: {
							let i = "Token with \"" + r.type + "\" type was not found.";
							if (this.options.silent) return console.error(i), "";
							throw new Error(i);
						}
					}
				}
				return t;
			}
			parseInline(e, t = this.renderer) {
				this.renderer.parser = this;
				let n = "";
				for (let s = 0; s < e.length; s++) {
					let r = e[s];
					if (this.options.extensions?.renderers?.[r.type]) {
						let o = this.options.extensions.renderers[r.type].call({ parser: this }, r);
						if (o !== !1 || ![
							"escape",
							"html",
							"link",
							"image",
							"checkbox",
							"strong",
							"em",
							"codespan",
							"br",
							"del",
							"text"
						].includes(r.type)) {
							n += o || "";
							continue;
						}
					}
					let i = r;
					switch (i.type) {
						case "escape":
							n += t.text(i);
							break;
						case "html":
							n += t.html(i);
							break;
						case "link":
							n += t.link(i);
							break;
						case "image":
							n += t.image(i);
							break;
						case "checkbox":
							n += t.checkbox(i);
							break;
						case "strong":
							n += t.strong(i);
							break;
						case "em":
							n += t.em(i);
							break;
						case "codespan":
							n += t.codespan(i);
							break;
						case "br":
							n += t.br(i);
							break;
						case "del":
							n += t.del(i);
							break;
						case "text":
							n += t.text(i);
							break;
						default: {
							let o = "Token with \"" + i.type + "\" type was not found.";
							if (this.options.silent) return console.error(o), "";
							throw new Error(o);
						}
					}
				}
				return n;
			}
		};
		var S = class {
			options;
			block;
			constructor(e) {
				this.options = e || R;
			}
			static passThroughHooks = /* @__PURE__ */ new Set([
				"preprocess",
				"postprocess",
				"processAllTokens",
				"emStrongMask"
			]);
			static passThroughHooksRespectAsync = /* @__PURE__ */ new Set([
				"preprocess",
				"postprocess",
				"processAllTokens"
			]);
			preprocess(e) {
				return e;
			}
			postprocess(e) {
				return e;
			}
			processAllTokens(e) {
				return e;
			}
			emStrongMask(e) {
				return e;
			}
			provideLexer(e = this.block) {
				return e ? x.lex : x.lexInline;
			}
			provideParser(e = this.block) {
				return e ? b.parse : b.parseInline;
			}
		};
		var Z = class {
			defaults = A();
			options = this.setOptions;
			parse = this.parseMarkdown(!0);
			parseInline = this.parseMarkdown(!1);
			Parser = b;
			Renderer = P;
			TextRenderer = L;
			Lexer = x;
			Tokenizer = y;
			Hooks = S;
			constructor(...e) {
				this.use(...e);
			}
			walkTokens(e, t) {
				let n = [];
				for (let s of e) switch (n = n.concat(t.call(this, s)), s.type) {
					case "table": {
						let r = s;
						for (let i of r.header) n = n.concat(this.walkTokens(i.tokens, t));
						for (let i of r.rows) for (let o of i) n = n.concat(this.walkTokens(o.tokens, t));
						break;
					}
					case "list": {
						let r = s;
						n = n.concat(this.walkTokens(r.items, t));
						break;
					}
					default: {
						let r = s;
						this.defaults.extensions?.childTokens?.[r.type] ? this.defaults.extensions.childTokens[r.type].forEach((i) => {
							let o = r[i].flat(1 / 0);
							n = n.concat(this.walkTokens(o, t));
						}) : r.tokens && (n = n.concat(this.walkTokens(r.tokens, t)));
					}
				}
				return n;
			}
			use(...e) {
				let t = this.defaults.extensions || {
					renderers: {},
					childTokens: {}
				};
				return e.forEach((n) => {
					let s = { ...n };
					if (s.async = this.defaults.async || s.async || !1, n.extensions && (n.extensions.forEach((r) => {
						if (!r.name) throw new Error("extension name required");
						if ("renderer" in r) {
							let i = t.renderers[r.name];
							i ? t.renderers[r.name] = function(...o) {
								let u = r.renderer.apply(this, o);
								return u === !1 && (u = i.apply(this, o)), u;
							} : t.renderers[r.name] = r.renderer;
						}
						if ("tokenizer" in r) {
							if (!r.level || r.level !== "block" && r.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
							let i = t[r.level];
							i ? i.unshift(r.tokenizer) : t[r.level] = [r.tokenizer], r.start && (r.level === "block" ? t.startBlock ? t.startBlock.push(r.start) : t.startBlock = [r.start] : r.level === "inline" && (t.startInline ? t.startInline.push(r.start) : t.startInline = [r.start]));
						}
						"childTokens" in r && r.childTokens && (t.childTokens[r.name] = r.childTokens);
					}), s.extensions = t), n.renderer) {
						let r = this.defaults.renderer || new P(this.defaults);
						for (let i in n.renderer) {
							if (!(i in r)) throw new Error(`renderer '${i}' does not exist`);
							if (["options", "parser"].includes(i)) continue;
							let o = i, u = n.renderer[o], a = r[o];
							r[o] = (...p) => {
								let c = u.apply(r, p);
								return c === !1 && (c = a.apply(r, p)), c || "";
							};
						}
						s.renderer = r;
					}
					if (n.tokenizer) {
						let r = this.defaults.tokenizer || new y(this.defaults);
						for (let i in n.tokenizer) {
							if (!(i in r)) throw new Error(`tokenizer '${i}' does not exist`);
							if ([
								"options",
								"rules",
								"lexer"
							].includes(i)) continue;
							let o = i, u = n.tokenizer[o], a = r[o];
							r[o] = (...p) => {
								let c = u.apply(r, p);
								return c === !1 && (c = a.apply(r, p)), c;
							};
						}
						s.tokenizer = r;
					}
					if (n.hooks) {
						let r = this.defaults.hooks || new S();
						for (let i in n.hooks) {
							if (!(i in r)) throw new Error(`hook '${i}' does not exist`);
							if (["options", "block"].includes(i)) continue;
							let o = i, u = n.hooks[o], a = r[o];
							S.passThroughHooks.has(i) ? r[o] = (p) => {
								if (this.defaults.async && S.passThroughHooksRespectAsync.has(i)) return (async () => {
									let h = await u.call(r, p);
									return a.call(r, h);
								})();
								let c = u.call(r, p);
								return a.call(r, c);
							} : r[o] = (...p) => {
								if (this.defaults.async) return (async () => {
									let h = await u.apply(r, p);
									return h === !1 && (h = await a.apply(r, p)), h;
								})();
								let c = u.apply(r, p);
								return c === !1 && (c = a.apply(r, p)), c;
							};
						}
						s.hooks = r;
					}
					if (n.walkTokens) {
						let r = this.defaults.walkTokens, i = n.walkTokens;
						s.walkTokens = function(o) {
							let u = [];
							return u.push(i.call(this, o)), r && (u = u.concat(r.call(this, o))), u;
						};
					}
					this.defaults = {
						...this.defaults,
						...s
					};
				}), this;
			}
			setOptions(e) {
				return this.defaults = {
					...this.defaults,
					...e
				}, this;
			}
			lexer(e, t) {
				return x.lex(e, t ?? this.defaults);
			}
			parser(e, t) {
				return b.parse(e, t ?? this.defaults);
			}
			parseMarkdown(e) {
				return (n, s) => {
					let r = { ...s }, i = {
						...this.defaults,
						...r
					}, o = this.onError(!!i.silent, !!i.async);
					if (this.defaults.async === !0 && r.async === !1) return o(/* @__PURE__ */ new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
					if (typeof n > "u" || n === null) return o(/* @__PURE__ */ new Error("marked(): input parameter is undefined or null"));
					if (typeof n != "string") return o(/* @__PURE__ */ new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
					if (i.hooks && (i.hooks.options = i, i.hooks.block = e), i.async) return (async () => {
						let u = i.hooks ? await i.hooks.preprocess(n) : n, p = await (i.hooks ? await i.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(u, i), c = i.hooks ? await i.hooks.processAllTokens(p) : p;
						i.walkTokens && await Promise.all(this.walkTokens(c, i.walkTokens));
						let d = await (i.hooks ? await i.hooks.provideParser(e) : e ? b.parse : b.parseInline)(c, i);
						return i.hooks ? await i.hooks.postprocess(d) : d;
					})().catch(o);
					try {
						i.hooks && (n = i.hooks.preprocess(n));
						let a = (i.hooks ? i.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(n, i);
						i.hooks && (a = i.hooks.processAllTokens(a)), i.walkTokens && this.walkTokens(a, i.walkTokens);
						let c = (i.hooks ? i.hooks.provideParser(e) : e ? b.parse : b.parseInline)(a, i);
						return i.hooks && (c = i.hooks.postprocess(c)), c;
					} catch (u) {
						return o(u);
					}
				};
			}
			onError(e, t) {
				return (n) => {
					if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
						let s = "<p>An error occurred:</p><pre>" + T(n.message + "", !0) + "</pre>";
						return t ? Promise.resolve(s) : s;
					}
					if (t) return Promise.reject(n);
					throw n;
				};
			}
		};
		var M = new Z();
		function f(l, e) {
			return M.parse(l, e);
		}
		f.options = f.setOptions = function(l) {
			return M.setOptions(l), f.defaults = M.defaults, j(f.defaults), f;
		};
		f.getDefaults = A;
		f.defaults = R;
		function dt(...l) {
			return M.use(...l), f.defaults = M.defaults, j(f.defaults), f;
		}
		f.use = dt;
		f.walkTokens = function(l, e) {
			return M.walkTokens(l, e);
		};
		f.parseInline = M.parseInline;
		f.Parser = b;
		f.parser = b.parse;
		f.Renderer = P;
		f.TextRenderer = L;
		f.Lexer = x;
		f.lexer = x.lex;
		f.Tokenizer = y;
		f.Hooks = S;
		f.parse = f;
		f.options;
		f.setOptions;
		f.walkTokens;
		f.parseInline;
		b.parse;
		x.lex;
		//#endregion
		//#region node_modules/dompurify/dist/purify.es.mjs
		/*! @license DOMPurify 3.4.14 | (c) Cure53 and other contributors | Released under the Apache license 2.0 and Mozilla Public License 2.0 | github.com/cure53/DOMPurify/blob/3.4.14/LICENSE */
		function _arrayLikeToArray(r, a) {
			(null == a || a > r.length) && (a = r.length);
			for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
			return n;
		}
		function _arrayWithHoles(r) {
			if (Array.isArray(r)) return r;
		}
		function _iterableToArrayLimit(r, l) {
			var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];
			if (null != t) {
				var e, n, i, u, a = [], f = true, o = false;
				try {
					if (i = (t = t.call(r)).next, 0 === l);
					else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0);
				} catch (r) {
					o = true, n = r;
				} finally {
					try {
						if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return;
					} finally {
						if (o) throw n;
					}
				}
				return a;
			}
		}
		function _nonIterableRest() {
			throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
		}
		function _slicedToArray(r, e) {
			return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
		}
		function _unsupportedIterableToArray(r, a) {
			if (r) {
				if ("string" == typeof r) return _arrayLikeToArray(r, a);
				var t = {}.toString.call(r).slice(8, -1);
				return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
			}
		}
		const entries = Object.entries;
		const setPrototypeOf = Object.setPrototypeOf;
		const isFrozen = Object.isFrozen;
		const getPrototypeOf = Object.getPrototypeOf;
		const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
		let freeze = Object.freeze;
		let seal = Object.seal;
		let create = Object.create;
		let _ref = typeof Reflect !== "undefined" && Reflect;
		let apply$1 = _ref.apply;
		let construct = _ref.construct;
		if (!freeze) freeze = function freeze(x) {
			return x;
		};
		if (!seal) seal = function seal(x) {
			return x;
		};
		if (!apply$1) apply$1 = function apply(func, thisArg) {
			for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
			return func.apply(thisArg, args);
		};
		if (!construct) construct = function construct(Func) {
			for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) args[_key2 - 1] = arguments[_key2];
			return new Func(...args);
		};
		const arrayForEach = unapply(Array.prototype.forEach);
		const arrayLastIndexOf = unapply(Array.prototype.lastIndexOf);
		const arrayPop = unapply(Array.prototype.pop);
		const arrayPush = unapply(Array.prototype.push);
		const arraySplice = unapply(Array.prototype.splice);
		const arrayIsArray = Array.isArray;
		const stringToLowerCase = unapply(String.prototype.toLowerCase);
		const stringToString = unapply(String.prototype.toString);
		const stringMatch = unapply(String.prototype.match);
		const stringReplace = unapply(String.prototype.replace);
		const stringIndexOf = unapply(String.prototype.indexOf);
		const stringTrim = unapply(String.prototype.trim);
		const numberToString = unapply(Number.prototype.toString);
		const booleanToString = unapply(Boolean.prototype.toString);
		const bigintToString = typeof BigInt === "undefined" ? null : unapply(BigInt.prototype.toString);
		const symbolToString = typeof Symbol === "undefined" ? null : unapply(Symbol.prototype.toString);
		const objectHasOwnProperty = unapply(Object.prototype.hasOwnProperty);
		const objectToString = unapply(Object.prototype.toString);
		const regExpTest = unapply(RegExp.prototype.test);
		const typeErrorCreate = unconstruct(TypeError);
		/**
		* Creates a new function that calls the given function with a specified thisArg and arguments.
		*
		* @param func - The function to be wrapped and called.
		* @returns A new function that calls the given function with a specified thisArg and arguments.
		*/
		function unapply(func) {
			return function(thisArg) {
				if (thisArg instanceof RegExp) thisArg.lastIndex = 0;
				for (var _len3 = arguments.length, args = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) args[_key3 - 1] = arguments[_key3];
				return apply$1(func, thisArg, args);
			};
		}
		/**
		* Creates a new function that constructs an instance of the given constructor function with the provided arguments.
		*
		* @param func - The constructor function to be wrapped and called.
		* @returns A new function that constructs an instance of the given constructor function with the provided arguments.
		*/
		function unconstruct(Func) {
			return function() {
				for (var _len4 = arguments.length, args = new Array(_len4), _key4 = 0; _key4 < _len4; _key4++) args[_key4] = arguments[_key4];
				return construct(Func, args);
			};
		}
		/**
		* Add properties to a lookup table
		*
		* @param set - The set to which elements will be added.
		* @param array - The array containing elements to be added to the set.
		* @param transformCaseFunc - An optional function to transform the case of each element before adding to the set.
		* @returns The modified set with added elements.
		*/
		function addToSet(set, array) {
			let transformCaseFunc = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : stringToLowerCase;
			if (setPrototypeOf) setPrototypeOf(set, null);
			if (!arrayIsArray(array)) return set;
			let l = array.length;
			while (l--) {
				let element = array[l];
				if (typeof element === "string") {
					const lcElement = transformCaseFunc(element);
					if (lcElement !== element) {
						if (!isFrozen(array)) array[l] = lcElement;
						element = lcElement;
					}
				}
				set[element] = true;
			}
			return set;
		}
		/**
		* Clean up an array to harden against CSPP
		*
		* @param array - The array to be cleaned.
		* @returns The cleaned version of the array
		*/
		function cleanArray(array) {
			for (let index = 0; index < array.length; index++) if (!objectHasOwnProperty(array, index)) array[index] = null;
			return array;
		}
		/**
		* Shallow clone an object
		*
		* @param object - The object to be cloned.
		* @returns A new object that copies the original.
		*/
		function clone(object) {
			const newObject = create(null);
			for (const _ref2 of entries(object)) {
				var _ref3 = _slicedToArray(_ref2, 2);
				const property = _ref3[0];
				const value = _ref3[1];
				if (objectHasOwnProperty(object, property)) {
					if (arrayIsArray(value)) newObject[property] = cleanArray(value);
					else if (value && typeof value === "object" && value.constructor === Object) newObject[property] = clone(value);
					else newObject[property] = value;
				}
			}
			return newObject;
		}
		/**
		* Convert non-node values into strings without depending on direct property access.
		*
		* @param value - The value to stringify.
		* @returns A string representation of the provided value.
		*/
		function stringifyValue(value) {
			switch (typeof value) {
				case "string": return value;
				case "number": return numberToString(value);
				case "boolean": return booleanToString(value);
				case "bigint": return bigintToString ? bigintToString(value) : "0";
				case "symbol": return symbolToString ? symbolToString(value) : "Symbol()";
				case "undefined": return objectToString(value);
				case "function":
				case "object": {
					if (value === null) return objectToString(value);
					const valueAsRecord = value;
					const valueToString = lookupGetter(valueAsRecord, "toString");
					if (typeof valueToString === "function") {
						const stringified = valueToString(valueAsRecord);
						return typeof stringified === "string" ? stringified : objectToString(stringified);
					}
					return objectToString(value);
				}
				default: return objectToString(value);
			}
		}
		/**
		* This method automatically checks if the prop is function or getter and behaves accordingly.
		*
		* @param object - The object to look up the getter function in its prototype chain.
		* @param prop - The property name for which to find the getter function.
		* @returns The getter function found in the prototype chain or a fallback function.
		*/
		function lookupGetter(object, prop) {
			while (object !== null) {
				const desc = getOwnPropertyDescriptor(object, prop);
				if (desc) {
					if (desc.get) return unapply(desc.get);
					if (typeof desc.value === "function") return unapply(desc.value);
				}
				object = getPrototypeOf(object);
			}
			function fallbackValue() {
				return null;
			}
			return fallbackValue;
		}
		function isRegex(value) {
			try {
				regExpTest(value, "");
				return true;
			} catch (_unused) {
				return false;
			}
		}
		const html$1 = freeze([
			"a",
			"abbr",
			"acronym",
			"address",
			"area",
			"article",
			"aside",
			"audio",
			"b",
			"bdi",
			"bdo",
			"big",
			"blink",
			"blockquote",
			"body",
			"br",
			"button",
			"canvas",
			"caption",
			"center",
			"cite",
			"code",
			"col",
			"colgroup",
			"content",
			"data",
			"datalist",
			"dd",
			"decorator",
			"del",
			"details",
			"dfn",
			"dialog",
			"dir",
			"div",
			"dl",
			"dt",
			"element",
			"em",
			"fieldset",
			"figcaption",
			"figure",
			"font",
			"footer",
			"form",
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
			"head",
			"header",
			"hgroup",
			"hr",
			"html",
			"i",
			"img",
			"input",
			"ins",
			"kbd",
			"label",
			"legend",
			"li",
			"main",
			"map",
			"mark",
			"marquee",
			"menu",
			"menuitem",
			"meter",
			"nav",
			"nobr",
			"ol",
			"optgroup",
			"option",
			"output",
			"p",
			"picture",
			"pre",
			"progress",
			"q",
			"rp",
			"rt",
			"ruby",
			"s",
			"samp",
			"search",
			"section",
			"select",
			"shadow",
			"slot",
			"small",
			"source",
			"spacer",
			"span",
			"strike",
			"strong",
			"style",
			"sub",
			"summary",
			"sup",
			"table",
			"tbody",
			"td",
			"template",
			"textarea",
			"tfoot",
			"th",
			"thead",
			"time",
			"tr",
			"track",
			"tt",
			"u",
			"ul",
			"var",
			"video",
			"wbr"
		]);
		const svg$1 = freeze([
			"svg",
			"a",
			"altglyph",
			"altglyphdef",
			"altglyphitem",
			"animatecolor",
			"animatemotion",
			"animatetransform",
			"circle",
			"clippath",
			"defs",
			"desc",
			"ellipse",
			"enterkeyhint",
			"exportparts",
			"filter",
			"font",
			"g",
			"glyph",
			"glyphref",
			"hkern",
			"image",
			"inputmode",
			"line",
			"lineargradient",
			"marker",
			"mask",
			"metadata",
			"mpath",
			"part",
			"path",
			"pattern",
			"polygon",
			"polyline",
			"radialgradient",
			"rect",
			"stop",
			"style",
			"switch",
			"symbol",
			"text",
			"textpath",
			"title",
			"tref",
			"tspan",
			"view",
			"vkern"
		]);
		const svgFilters = freeze([
			"feBlend",
			"feColorMatrix",
			"feComponentTransfer",
			"feComposite",
			"feConvolveMatrix",
			"feDiffuseLighting",
			"feDisplacementMap",
			"feDistantLight",
			"feDropShadow",
			"feFlood",
			"feFuncA",
			"feFuncB",
			"feFuncG",
			"feFuncR",
			"feGaussianBlur",
			"feImage",
			"feMerge",
			"feMergeNode",
			"feMorphology",
			"feOffset",
			"fePointLight",
			"feSpecularLighting",
			"feSpotLight",
			"feTile",
			"feTurbulence"
		]);
		const svgDisallowed = freeze([
			"animate",
			"color-profile",
			"cursor",
			"discard",
			"font-face",
			"font-face-format",
			"font-face-name",
			"font-face-src",
			"font-face-uri",
			"foreignobject",
			"hatch",
			"hatchpath",
			"mesh",
			"meshgradient",
			"meshpatch",
			"meshrow",
			"missing-glyph",
			"script",
			"set",
			"solidcolor",
			"unknown",
			"use"
		]);
		const mathMl$1 = freeze([
			"math",
			"menclose",
			"merror",
			"mfenced",
			"mfrac",
			"mglyph",
			"mi",
			"mlabeledtr",
			"mmultiscripts",
			"mn",
			"mo",
			"mover",
			"mpadded",
			"mphantom",
			"mroot",
			"mrow",
			"ms",
			"mspace",
			"msqrt",
			"mstyle",
			"msub",
			"msup",
			"msubsup",
			"mtable",
			"mtd",
			"mtext",
			"mtr",
			"munder",
			"munderover",
			"mprescripts"
		]);
		const mathMlDisallowed = freeze([
			"maction",
			"maligngroup",
			"malignmark",
			"mlongdiv",
			"mscarries",
			"mscarry",
			"msgroup",
			"mstack",
			"msline",
			"msrow",
			"semantics",
			"annotation",
			"annotation-xml",
			"mprescripts",
			"none"
		]);
		const text = freeze(["#text"]);
		const html = freeze([
			"accept",
			"action",
			"align",
			"alt",
			"autocapitalize",
			"autocomplete",
			"autopictureinpicture",
			"autoplay",
			"background",
			"bgcolor",
			"border",
			"capture",
			"cellpadding",
			"cellspacing",
			"checked",
			"cite",
			"class",
			"clear",
			"color",
			"cols",
			"colspan",
			"command",
			"commandfor",
			"controls",
			"controlslist",
			"coords",
			"crossorigin",
			"datetime",
			"decoding",
			"default",
			"dir",
			"disabled",
			"disablepictureinpicture",
			"disableremoteplayback",
			"download",
			"draggable",
			"enctype",
			"enterkeyhint",
			"exportparts",
			"face",
			"for",
			"headers",
			"height",
			"hidden",
			"high",
			"href",
			"hreflang",
			"id",
			"inert",
			"inputmode",
			"integrity",
			"ismap",
			"kind",
			"label",
			"lang",
			"list",
			"loading",
			"loop",
			"low",
			"max",
			"maxlength",
			"media",
			"method",
			"min",
			"minlength",
			"multiple",
			"muted",
			"name",
			"nonce",
			"noshade",
			"novalidate",
			"nowrap",
			"open",
			"optimum",
			"part",
			"pattern",
			"placeholder",
			"playsinline",
			"popover",
			"popovertarget",
			"popovertargetaction",
			"poster",
			"preload",
			"pubdate",
			"radiogroup",
			"readonly",
			"rel",
			"required",
			"rev",
			"reversed",
			"role",
			"rows",
			"rowspan",
			"spellcheck",
			"scope",
			"selected",
			"shape",
			"size",
			"sizes",
			"slot",
			"span",
			"srclang",
			"start",
			"src",
			"srcset",
			"step",
			"style",
			"summary",
			"tabindex",
			"title",
			"translate",
			"type",
			"usemap",
			"valign",
			"value",
			"width",
			"wrap",
			"xmlns"
		]);
		const svg = freeze([
			"accent-height",
			"accumulate",
			"additive",
			"alignment-baseline",
			"amplitude",
			"ascent",
			"attributename",
			"attributetype",
			"azimuth",
			"basefrequency",
			"baseline-shift",
			"begin",
			"bias",
			"by",
			"class",
			"clip",
			"clippathunits",
			"clip-path",
			"clip-rule",
			"color",
			"color-interpolation",
			"color-interpolation-filters",
			"color-profile",
			"color-rendering",
			"cx",
			"cy",
			"d",
			"dx",
			"dy",
			"diffuseconstant",
			"direction",
			"display",
			"divisor",
			"dominant-baseline",
			"dur",
			"edgemode",
			"elevation",
			"end",
			"exponent",
			"fill",
			"fill-opacity",
			"fill-rule",
			"filter",
			"filterunits",
			"flood-color",
			"flood-opacity",
			"font-family",
			"font-size",
			"font-size-adjust",
			"font-stretch",
			"font-style",
			"font-variant",
			"font-weight",
			"fx",
			"fy",
			"g1",
			"g2",
			"glyph-name",
			"glyphref",
			"gradientunits",
			"gradienttransform",
			"height",
			"href",
			"id",
			"image-rendering",
			"in",
			"in2",
			"intercept",
			"k",
			"k1",
			"k2",
			"k3",
			"k4",
			"kerning",
			"keypoints",
			"keysplines",
			"keytimes",
			"lang",
			"lengthadjust",
			"letter-spacing",
			"kernelmatrix",
			"kernelunitlength",
			"lighting-color",
			"local",
			"marker-end",
			"marker-mid",
			"marker-start",
			"markerheight",
			"markerunits",
			"markerwidth",
			"maskcontentunits",
			"maskunits",
			"max",
			"mask",
			"mask-type",
			"media",
			"method",
			"mode",
			"min",
			"name",
			"numoctaves",
			"offset",
			"operator",
			"opacity",
			"order",
			"orient",
			"orientation",
			"origin",
			"overflow",
			"paint-order",
			"path",
			"pathlength",
			"patterncontentunits",
			"patterntransform",
			"patternunits",
			"pointer-events",
			"points",
			"preservealpha",
			"preserveaspectratio",
			"primitiveunits",
			"r",
			"rx",
			"ry",
			"radius",
			"refx",
			"refy",
			"repeatcount",
			"repeatdur",
			"restart",
			"result",
			"rotate",
			"scale",
			"seed",
			"shape-rendering",
			"slope",
			"specularconstant",
			"specularexponent",
			"spreadmethod",
			"startoffset",
			"stddeviation",
			"stitchtiles",
			"stop-color",
			"stop-opacity",
			"stroke-dasharray",
			"stroke-dashoffset",
			"stroke-linecap",
			"stroke-linejoin",
			"stroke-miterlimit",
			"stroke-opacity",
			"stroke",
			"stroke-width",
			"style",
			"surfacescale",
			"systemlanguage",
			"tabindex",
			"tablevalues",
			"targetx",
			"targety",
			"transform",
			"transform-origin",
			"text-anchor",
			"text-decoration",
			"text-orientation",
			"text-rendering",
			"textlength",
			"type",
			"u1",
			"u2",
			"unicode",
			"values",
			"vector-effect",
			"viewbox",
			"visibility",
			"version",
			"vert-adv-y",
			"vert-origin-x",
			"vert-origin-y",
			"width",
			"word-spacing",
			"wrap",
			"writing-mode",
			"xchannelselector",
			"ychannelselector",
			"x",
			"x1",
			"x2",
			"xmlns",
			"y",
			"y1",
			"y2",
			"z",
			"zoomandpan"
		]);
		const mathMl = freeze([
			"accent",
			"accentunder",
			"align",
			"bevelled",
			"close",
			"columnalign",
			"columnlines",
			"columnspacing",
			"columnspan",
			"denomalign",
			"depth",
			"dir",
			"display",
			"displaystyle",
			"encoding",
			"fence",
			"frame",
			"height",
			"href",
			"id",
			"largeop",
			"length",
			"linethickness",
			"lquote",
			"lspace",
			"mathbackground",
			"mathcolor",
			"mathsize",
			"mathvariant",
			"maxsize",
			"minsize",
			"movablelimits",
			"notation",
			"numalign",
			"open",
			"rowalign",
			"rowlines",
			"rowspacing",
			"rowspan",
			"rspace",
			"rquote",
			"scriptlevel",
			"scriptminsize",
			"scriptsizemultiplier",
			"selection",
			"separator",
			"separators",
			"stretchy",
			"subscriptshift",
			"supscriptshift",
			"symmetric",
			"voffset",
			"width",
			"xmlns"
		]);
		const xml = freeze([
			"xlink:href",
			"xml:id",
			"xlink:title",
			"xml:space",
			"xmlns:xlink"
		]);
		const MUSTACHE_EXPR = seal(/{{[\w\W]*|^[\w\W]*}}/g);
		const ERB_EXPR = seal(/<%[\w\W]*|^[\w\W]*%>/g);
		const TMPLIT_EXPR = seal(/\${[\w\W]*/g);
		const DATA_ATTR = seal(/^data-[\-\w.\u00B7-\uFFFF]+$/);
		const ARIA_ATTR = seal(/^aria-[\-\w]+$/);
		const IS_ALLOWED_URI = seal(/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i);
		const IS_SCRIPT_OR_DATA = seal(/^(?:\w+script|data):/i);
		const ATTR_WHITESPACE = seal(/[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g);
		const DOCTYPE_NAME = seal(/^html$/i);
		const CUSTOM_ELEMENT = seal(/^[a-z][.\w]*(-[.\w]+)+$/i);
		const ELEMENT_MARKUP_PROBE = seal(/<[/\w!]/g);
		const COMMENT_MARKUP_PROBE = seal(/<[/\w]/g);
		const FALLBACK_TAG_CLOSE = seal(/<\/no(script|embed|frames)/i);
		const SELF_CLOSING_TAG = seal(/\/>/i);
		const NODE_TYPE = {
			element: 1,
			attribute: 2,
			text: 3,
			cdataSection: 4,
			entityReference: 5,
			entityNode: 6,
			processingInstruction: 7,
			comment: 8,
			document: 9,
			documentType: 10,
			documentFragment: 11,
			notation: 12
		};
		const LITERAL_TEXT_ELEMENT_NAMES = [
			"style",
			"script",
			"xmp",
			"iframe",
			"noembed",
			"noframes",
			"plaintext",
			"noscript"
		];
		const LITERAL_TEXT_ELEMENTS = freeze(addToSet({}, LITERAL_TEXT_ELEMENT_NAMES));
		const LITERAL_TEXT_CLOSE = function() {
			const map = {};
			arrayForEach(LITERAL_TEXT_ELEMENT_NAMES, (name) => {
				map[name] = seal(new RegExp("</" + name + "(?=[\\t\\n\\f\\r />])", "i"));
			});
			return freeze(map);
		}();
		const getGlobal = function getGlobal() {
			return typeof window === "undefined" ? null : window;
		};
		/**
		* Creates a no-op policy for internal use only.
		* Don't export this function outside this module!
		* @param trustedTypes The policy factory.
		* @param purifyHostElement The Script element used to load DOMPurify (to determine policy name suffix).
		* @return The policy created (or null, if Trusted Types
		* are not supported or creating the policy failed).
		*/
		const _createTrustedTypesPolicy = function _createTrustedTypesPolicy(trustedTypes, purifyHostElement) {
			if (typeof trustedTypes !== "object" || typeof trustedTypes.createPolicy !== "function") return null;
			let suffix = null;
			const ATTR_NAME = "data-tt-policy-suffix";
			if (purifyHostElement && purifyHostElement.hasAttribute(ATTR_NAME)) suffix = purifyHostElement.getAttribute(ATTR_NAME);
			const policyName = "dompurify" + (suffix ? "#" + suffix : "");
			try {
				return trustedTypes.createPolicy(policyName, {
					createHTML(html) {
						return html;
					},
					createScriptURL(scriptUrl) {
						return scriptUrl;
					}
				});
			} catch (_) {
				console.warn("TrustedTypes policy " + policyName + " could not be created.");
				return null;
			}
		};
		const _createHooksMap = function _createHooksMap() {
			return {
				afterSanitizeAttributes: [],
				afterSanitizeElements: [],
				afterSanitizeShadowDOM: [],
				beforeSanitizeAttributes: [],
				beforeSanitizeElements: [],
				beforeSanitizeShadowDOM: [],
				uponSanitizeAttribute: [],
				uponSanitizeElement: [],
				uponSanitizeShadowNode: []
			};
		};
		/**
		* Resolve a set-valued configuration option: a fresh set built from
		* cfg[key] when it is an own array property (seeded with a clone of
		* options.base when given, case-normalized via options.transform),
		* the fallback set otherwise.
		*
		* @param cfg the cloned, prototype-free configuration object
		* @param key the configuration property to read
		* @param fallback the set to use when the option is absent or not an array
		* @param options transform and optional base set to merge into
		* @returns the resolved set
		*/
		const _resolveSetOption = function _resolveSetOption(cfg, key, fallback, options) {
			return objectHasOwnProperty(cfg, key) && arrayIsArray(cfg[key]) ? addToSet(options.base ? clone(options.base) : {}, cfg[key], options.transform) : fallback;
		};
		/**
		* Resolve an object-valued configuration option: a prototype-free clone
		* of cfg[key] when it is an own, truthy object property, else a fresh
		* fallback built by makeFallback (fresh on every parse, so a previous
		* parse can never leak state into the next one).
		*
		* @param cfg the cloned, prototype-free configuration object
		* @param key the configuration property to read
		* @param makeFallback builds the fallback value when the option is absent
		* @returns the resolved object
		*/
		const _resolveObjectOption = function _resolveObjectOption(cfg, key, makeFallback) {
			const value = objectHasOwnProperty(cfg, key) ? cfg[key] : void 0;
			return value && typeof value === "object" ? clone(value) : makeFallback();
		};
		function createDOMPurify() {
			let window = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : getGlobal();
			const DOMPurify = (root) => createDOMPurify(root);
			DOMPurify.version = "3.4.14";
			DOMPurify.removed = [];
			if (!window || !window.document || window.document.nodeType !== NODE_TYPE.document || !window.Element) {
				DOMPurify.isSupported = false;
				return DOMPurify;
			}
			let document = window.document;
			const originalDocument = document;
			const currentScript = originalDocument.currentScript;
			window.DocumentFragment;
			const HTMLTemplateElement = window.HTMLTemplateElement, Node = window.Node, Element = window.Element, NodeFilter = window.NodeFilter;
			window.NamedNodeMap === void 0 && (window.NamedNodeMap || window.MozNamedAttrMap);
			window.HTMLFormElement;
			const DOMParser = window.DOMParser, trustedTypes = window.trustedTypes;
			const ElementPrototype = Element.prototype;
			const cloneNode = lookupGetter(ElementPrototype, "cloneNode");
			const remove = lookupGetter(ElementPrototype, "remove");
			const getNextSibling = lookupGetter(ElementPrototype, "nextSibling");
			const getChildNodes = lookupGetter(ElementPrototype, "childNodes");
			const getParentNode = lookupGetter(ElementPrototype, "parentNode");
			const getShadowRoot = lookupGetter(ElementPrototype, "shadowRoot");
			const getAttributes = lookupGetter(ElementPrototype, "attributes");
			const getNodeType = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeType") : null;
			const getNodeName = Node && Node.prototype ? lookupGetter(Node.prototype, "nodeName") : null;
			const getOwnerDocument = Node && Node.prototype ? lookupGetter(Node.prototype, "ownerDocument") : null;
			const _readNodeType = function _readNodeType(node) {
				return getNodeType ? getNodeType(node) : node.nodeType;
			};
			const _readNodeName = function _readNodeName(node) {
				return getNodeName ? getNodeName(node) : node.nodeName;
			};
			if (typeof HTMLTemplateElement === "function") {
				const template = document.createElement("template");
				if (template.content && template.content.ownerDocument) document = template.content.ownerDocument;
			}
			let trustedTypesPolicy;
			let emptyHTML = "";
			let defaultTrustedTypesPolicy;
			let defaultTrustedTypesPolicyResolved = false;
			let IN_TRUSTED_TYPES_POLICY = 0;
			const _assertNotInTrustedTypesPolicy = function _assertNotInTrustedTypesPolicy() {
				if (IN_TRUSTED_TYPES_POLICY > 0) throw typeErrorCreate("A configured TRUSTED_TYPES_POLICY callback (createHTML or createScriptURL) must not call DOMPurify.sanitize, as that causes infinite recursion. Do not pass a policy whose callbacks wrap DOMPurify as TRUSTED_TYPES_POLICY; see the \"DOMPurify and Trusted Types\" section of the README.");
			};
			const _createTrustedHTML = function _createTrustedHTML(html) {
				_assertNotInTrustedTypesPolicy();
				IN_TRUSTED_TYPES_POLICY++;
				try {
					return trustedTypesPolicy.createHTML(html);
				} finally {
					IN_TRUSTED_TYPES_POLICY--;
				}
			};
			const _createTrustedScriptURL = function _createTrustedScriptURL(scriptUrl) {
				_assertNotInTrustedTypesPolicy();
				IN_TRUSTED_TYPES_POLICY++;
				try {
					return trustedTypesPolicy.createScriptURL(scriptUrl);
				} finally {
					IN_TRUSTED_TYPES_POLICY--;
				}
			};
			const _getDefaultTrustedTypesPolicy = function _getDefaultTrustedTypesPolicy() {
				if (!defaultTrustedTypesPolicyResolved) {
					defaultTrustedTypesPolicy = _createTrustedTypesPolicy(trustedTypes, currentScript);
					defaultTrustedTypesPolicyResolved = true;
				}
				return defaultTrustedTypesPolicy;
			};
			const _document = document, implementation = _document.implementation, createNodeIterator = _document.createNodeIterator, createDocumentFragment = _document.createDocumentFragment, getElementsByTagName = _document.getElementsByTagName;
			const importNode = originalDocument.importNode;
			let hooks = _createHooksMap();
			/**
			* Expose whether this browser supports running the full DOMPurify.
			*/
			DOMPurify.isSupported = typeof entries === "function" && typeof getParentNode === "function" && implementation && implementation.createHTMLDocument !== void 0;
			const MUSTACHE_EXPR$1 = MUSTACHE_EXPR, ERB_EXPR$1 = ERB_EXPR, TMPLIT_EXPR$1 = TMPLIT_EXPR, DATA_ATTR$1 = DATA_ATTR, ARIA_ATTR$1 = ARIA_ATTR, IS_SCRIPT_OR_DATA$1 = IS_SCRIPT_OR_DATA, ATTR_WHITESPACE$1 = ATTR_WHITESPACE, CUSTOM_ELEMENT$1 = CUSTOM_ELEMENT;
			let IS_ALLOWED_URI$1 = IS_ALLOWED_URI;
			/**
			* We consider the elements and attributes below to be safe. Ideally
			* don't add any new ones but feel free to remove unwanted ones.
			*/
			let ALLOWED_TAGS = null;
			const DEFAULT_ALLOWED_TAGS = addToSet({}, [
				...html$1,
				...svg$1,
				...svgFilters,
				...mathMl$1,
				...text
			]);
			let ALLOWED_ATTR = null;
			const DEFAULT_ALLOWED_ATTR = addToSet({}, [
				...html,
				...svg,
				...mathMl,
				...xml
			]);
			let CUSTOM_ELEMENT_HANDLING = Object.seal(create(null, {
				tagNameCheck: {
					writable: true,
					configurable: false,
					enumerable: true,
					value: null
				},
				attributeNameCheck: {
					writable: true,
					configurable: false,
					enumerable: true,
					value: null
				},
				allowCustomizedBuiltInElements: {
					writable: true,
					configurable: false,
					enumerable: true,
					value: false
				}
			}));
			let FORBID_TAGS = null;
			let FORBID_ATTR = null;
			const EXTRA_ELEMENT_HANDLING = Object.seal(create(null, {
				tagCheck: {
					writable: true,
					configurable: false,
					enumerable: true,
					value: null
				},
				attributeCheck: {
					writable: true,
					configurable: false,
					enumerable: true,
					value: null
				}
			}));
			let ALLOW_ARIA_ATTR = true;
			let ALLOW_DATA_ATTR = true;
			let ALLOW_UNKNOWN_PROTOCOLS = false;
			let ALLOW_SELF_CLOSE_IN_ATTR = true;
			let SAFE_FOR_TEMPLATES = false;
			let SAFE_FOR_XML = true;
			let WHOLE_DOCUMENT = false;
			let SET_CONFIG = false;
			let SET_CONFIG_ALLOWED_TAGS = null;
			let SET_CONFIG_ALLOWED_ATTR = null;
			let FORCE_BODY = false;
			let RETURN_DOM = false;
			let RETURN_DOM_FRAGMENT = false;
			let RETURN_TRUSTED_TYPE = false;
			let SANITIZE_DOM = true;
			let SANITIZE_NAMED_PROPS = false;
			const SANITIZE_NAMED_PROPS_PREFIX = "user-content-";
			let KEEP_CONTENT = true;
			let IN_PLACE = false;
			let USE_PROFILES = {};
			let FORBID_CONTENTS = null;
			const DEFAULT_FORBID_CONTENTS = addToSet({}, [
				"annotation-xml",
				"audio",
				"colgroup",
				"desc",
				"foreignobject",
				"head",
				"iframe",
				"math",
				"mi",
				"mn",
				"mo",
				"ms",
				"mtext",
				"noembed",
				"noframes",
				"noscript",
				"plaintext",
				"script",
				"selectedcontent",
				"style",
				"svg",
				"template",
				"thead",
				"title",
				"video",
				"xmp"
			]);
			let DATA_URI_TAGS = null;
			const DEFAULT_DATA_URI_TAGS = addToSet({}, [
				"audio",
				"video",
				"img",
				"source",
				"image",
				"track"
			]);
			let URI_SAFE_ATTRIBUTES = null;
			const DEFAULT_URI_SAFE_ATTRIBUTES = addToSet({}, [
				"alt",
				"class",
				"for",
				"id",
				"label",
				"name",
				"pattern",
				"placeholder",
				"role",
				"summary",
				"title",
				"value",
				"style",
				"xmlns"
			]);
			const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
			const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
			const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
			let NAMESPACE = HTML_NAMESPACE;
			let IS_EMPTY_INPUT = false;
			let ALLOWED_NAMESPACES = null;
			const DEFAULT_ALLOWED_NAMESPACES = addToSet({}, [
				MATHML_NAMESPACE,
				SVG_NAMESPACE,
				HTML_NAMESPACE
			], stringToString);
			const DEFAULT_MATHML_TEXT_INTEGRATION_POINTS = freeze([
				"mi",
				"mo",
				"mn",
				"ms",
				"mtext"
			]);
			let MATHML_TEXT_INTEGRATION_POINTS = addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS);
			const DEFAULT_HTML_INTEGRATION_POINTS = freeze(["annotation-xml"]);
			let HTML_INTEGRATION_POINTS = addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS);
			const COMMON_SVG_AND_HTML_ELEMENTS = addToSet({}, [
				"title",
				"style",
				"font",
				"a",
				"script"
			]);
			let PARSER_MEDIA_TYPE = null;
			const SUPPORTED_PARSER_MEDIA_TYPES = ["application/xhtml+xml", "text/html"];
			const DEFAULT_PARSER_MEDIA_TYPE = "text/html";
			let transformCaseFunc = null;
			let CONFIG = null;
			const formElement = document.createElement("form");
			const isRegexOrFunction = function isRegexOrFunction(testValue) {
				return testValue instanceof RegExp || testValue instanceof Function;
			};
			/**
			* _parseConfig
			*
			* @param cfg optional config literal
			*/
			const _parseConfig = function _parseConfig() {
				let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
				if (CONFIG && CONFIG === cfg) return;
				if (!cfg || typeof cfg !== "object") cfg = {};
				cfg = clone(cfg);
				PARSER_MEDIA_TYPE = SUPPORTED_PARSER_MEDIA_TYPES.indexOf(cfg.PARSER_MEDIA_TYPE) === -1 ? DEFAULT_PARSER_MEDIA_TYPE : cfg.PARSER_MEDIA_TYPE;
				transformCaseFunc = PARSER_MEDIA_TYPE === "application/xhtml+xml" ? stringToString : stringToLowerCase;
				ALLOWED_TAGS = _resolveSetOption(cfg, "ALLOWED_TAGS", DEFAULT_ALLOWED_TAGS, { transform: transformCaseFunc });
				ALLOWED_ATTR = _resolveSetOption(cfg, "ALLOWED_ATTR", DEFAULT_ALLOWED_ATTR, { transform: transformCaseFunc });
				ALLOWED_NAMESPACES = _resolveSetOption(cfg, "ALLOWED_NAMESPACES", DEFAULT_ALLOWED_NAMESPACES, { transform: stringToString });
				URI_SAFE_ATTRIBUTES = _resolveSetOption(cfg, "ADD_URI_SAFE_ATTR", DEFAULT_URI_SAFE_ATTRIBUTES, {
					transform: transformCaseFunc,
					base: DEFAULT_URI_SAFE_ATTRIBUTES
				});
				DATA_URI_TAGS = _resolveSetOption(cfg, "ADD_DATA_URI_TAGS", DEFAULT_DATA_URI_TAGS, {
					transform: transformCaseFunc,
					base: DEFAULT_DATA_URI_TAGS
				});
				FORBID_CONTENTS = _resolveSetOption(cfg, "FORBID_CONTENTS", DEFAULT_FORBID_CONTENTS, { transform: transformCaseFunc });
				FORBID_TAGS = _resolveSetOption(cfg, "FORBID_TAGS", clone({}), { transform: transformCaseFunc });
				FORBID_ATTR = _resolveSetOption(cfg, "FORBID_ATTR", clone({}), { transform: transformCaseFunc });
				USE_PROFILES = objectHasOwnProperty(cfg, "USE_PROFILES") ? cfg.USE_PROFILES && typeof cfg.USE_PROFILES === "object" ? clone(cfg.USE_PROFILES) : cfg.USE_PROFILES : false;
				ALLOW_ARIA_ATTR = cfg.ALLOW_ARIA_ATTR !== false;
				ALLOW_DATA_ATTR = cfg.ALLOW_DATA_ATTR !== false;
				ALLOW_UNKNOWN_PROTOCOLS = cfg.ALLOW_UNKNOWN_PROTOCOLS || false;
				ALLOW_SELF_CLOSE_IN_ATTR = cfg.ALLOW_SELF_CLOSE_IN_ATTR !== false;
				SAFE_FOR_TEMPLATES = cfg.SAFE_FOR_TEMPLATES || false;
				SAFE_FOR_XML = cfg.SAFE_FOR_XML !== false;
				WHOLE_DOCUMENT = cfg.WHOLE_DOCUMENT || false;
				RETURN_DOM = cfg.RETURN_DOM || false;
				RETURN_DOM_FRAGMENT = cfg.RETURN_DOM_FRAGMENT || false;
				RETURN_TRUSTED_TYPE = cfg.RETURN_TRUSTED_TYPE || false;
				FORCE_BODY = cfg.FORCE_BODY || false;
				SANITIZE_DOM = cfg.SANITIZE_DOM !== false;
				SANITIZE_NAMED_PROPS = cfg.SANITIZE_NAMED_PROPS || false;
				KEEP_CONTENT = cfg.KEEP_CONTENT !== false;
				IN_PLACE = cfg.IN_PLACE || false;
				IS_ALLOWED_URI$1 = isRegex(cfg.ALLOWED_URI_REGEXP) ? cfg.ALLOWED_URI_REGEXP : IS_ALLOWED_URI;
				NAMESPACE = typeof cfg.NAMESPACE === "string" ? cfg.NAMESPACE : HTML_NAMESPACE;
				MATHML_TEXT_INTEGRATION_POINTS = _resolveObjectOption(cfg, "MATHML_TEXT_INTEGRATION_POINTS", () => addToSet({}, DEFAULT_MATHML_TEXT_INTEGRATION_POINTS));
				HTML_INTEGRATION_POINTS = _resolveObjectOption(cfg, "HTML_INTEGRATION_POINTS", () => addToSet({}, DEFAULT_HTML_INTEGRATION_POINTS));
				const customElementHandling = _resolveObjectOption(cfg, "CUSTOM_ELEMENT_HANDLING", () => create(null));
				CUSTOM_ELEMENT_HANDLING = create(null);
				if (objectHasOwnProperty(customElementHandling, "tagNameCheck") && isRegexOrFunction(customElementHandling.tagNameCheck)) CUSTOM_ELEMENT_HANDLING.tagNameCheck = customElementHandling.tagNameCheck;
				if (objectHasOwnProperty(customElementHandling, "attributeNameCheck") && isRegexOrFunction(customElementHandling.attributeNameCheck)) CUSTOM_ELEMENT_HANDLING.attributeNameCheck = customElementHandling.attributeNameCheck;
				if (objectHasOwnProperty(customElementHandling, "allowCustomizedBuiltInElements") && typeof customElementHandling.allowCustomizedBuiltInElements === "boolean") CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements = customElementHandling.allowCustomizedBuiltInElements;
				seal(CUSTOM_ELEMENT_HANDLING);
				if (SAFE_FOR_TEMPLATES) ALLOW_DATA_ATTR = false;
				if (RETURN_DOM_FRAGMENT) RETURN_DOM = true;
				if (USE_PROFILES) {
					ALLOWED_TAGS = addToSet({}, text);
					ALLOWED_ATTR = create(null);
					if (USE_PROFILES.html === true) {
						addToSet(ALLOWED_TAGS, html$1);
						addToSet(ALLOWED_ATTR, html);
					}
					if (USE_PROFILES.svg === true) {
						addToSet(ALLOWED_TAGS, svg$1);
						addToSet(ALLOWED_ATTR, svg);
						addToSet(ALLOWED_ATTR, xml);
					}
					if (USE_PROFILES.svgFilters === true) {
						addToSet(ALLOWED_TAGS, svgFilters);
						addToSet(ALLOWED_ATTR, svg);
						addToSet(ALLOWED_ATTR, xml);
					}
					if (USE_PROFILES.mathMl === true) {
						addToSet(ALLOWED_TAGS, mathMl$1);
						addToSet(ALLOWED_ATTR, mathMl);
						addToSet(ALLOWED_ATTR, xml);
					}
				}
				EXTRA_ELEMENT_HANDLING.tagCheck = null;
				EXTRA_ELEMENT_HANDLING.attributeCheck = null;
				if (objectHasOwnProperty(cfg, "ADD_TAGS")) {
					if (typeof cfg.ADD_TAGS === "function") EXTRA_ELEMENT_HANDLING.tagCheck = cfg.ADD_TAGS;
					else if (arrayIsArray(cfg.ADD_TAGS)) {
						if (ALLOWED_TAGS === DEFAULT_ALLOWED_TAGS) ALLOWED_TAGS = clone(ALLOWED_TAGS);
						addToSet(ALLOWED_TAGS, cfg.ADD_TAGS, transformCaseFunc);
					}
				}
				if (objectHasOwnProperty(cfg, "ADD_ATTR")) {
					if (typeof cfg.ADD_ATTR === "function") EXTRA_ELEMENT_HANDLING.attributeCheck = cfg.ADD_ATTR;
					else if (arrayIsArray(cfg.ADD_ATTR)) {
						if (ALLOWED_ATTR === DEFAULT_ALLOWED_ATTR) ALLOWED_ATTR = clone(ALLOWED_ATTR);
						addToSet(ALLOWED_ATTR, cfg.ADD_ATTR, transformCaseFunc);
					}
				}
				if (objectHasOwnProperty(cfg, "ADD_FORBID_CONTENTS") && arrayIsArray(cfg.ADD_FORBID_CONTENTS)) {
					if (FORBID_CONTENTS === DEFAULT_FORBID_CONTENTS) FORBID_CONTENTS = clone(FORBID_CONTENTS);
					addToSet(FORBID_CONTENTS, cfg.ADD_FORBID_CONTENTS, transformCaseFunc);
				}
				if (KEEP_CONTENT) ALLOWED_TAGS["#text"] = true;
				if (WHOLE_DOCUMENT) addToSet(ALLOWED_TAGS, [
					"html",
					"head",
					"body"
				]);
				if (ALLOWED_TAGS.table) {
					addToSet(ALLOWED_TAGS, ["tbody"]);
					delete FORBID_TAGS.tbody;
				}
				if (cfg.TRUSTED_TYPES_POLICY) {
					if (typeof cfg.TRUSTED_TYPES_POLICY.createHTML !== "function") throw typeErrorCreate("TRUSTED_TYPES_POLICY configuration option must provide a \"createHTML\" hook.");
					if (typeof cfg.TRUSTED_TYPES_POLICY.createScriptURL !== "function") throw typeErrorCreate("TRUSTED_TYPES_POLICY configuration option must provide a \"createScriptURL\" hook.");
					const previousTrustedTypesPolicy = trustedTypesPolicy;
					trustedTypesPolicy = cfg.TRUSTED_TYPES_POLICY;
					try {
						emptyHTML = _createTrustedHTML("");
					} catch (error) {
						trustedTypesPolicy = previousTrustedTypesPolicy;
						throw error;
					}
				} else if (cfg.TRUSTED_TYPES_POLICY === null) {
					trustedTypesPolicy = void 0;
					emptyHTML = "";
				} else {
					if (trustedTypesPolicy === void 0) trustedTypesPolicy = _getDefaultTrustedTypesPolicy();
					if (trustedTypesPolicy && typeof emptyHTML === "string") emptyHTML = _createTrustedHTML("");
				}
				if (freeze) freeze(cfg);
				CONFIG = cfg;
			};
			const ALL_SVG_TAGS = addToSet({}, [
				...svg$1,
				...svgFilters,
				...svgDisallowed
			]);
			const ALL_MATHML_TAGS = addToSet({}, [...mathMl$1, ...mathMlDisallowed]);
			/**
			* Namespace rules for an element in the SVG namespace.
			*
			* @param tagName the element's lowercase tag name
			* @param parent the (possibly simulated) parent node
			* @param parentTagName the parent's lowercase tag name
			* @returns true if a spec-compliant parser could produce this element
			*/
			const _checkSvgNamespace = function _checkSvgNamespace(tagName, parent, parentTagName) {
				if (parent.namespaceURI === HTML_NAMESPACE) return tagName === "svg";
				if (parent.namespaceURI === MATHML_NAMESPACE) return tagName === "svg" && (parentTagName === "annotation-xml" || MATHML_TEXT_INTEGRATION_POINTS[parentTagName]);
				return Boolean(ALL_SVG_TAGS[tagName]);
			};
			/**
			* Namespace rules for an element in the MathML namespace.
			*
			* @param tagName the element's lowercase tag name
			* @param parent the (possibly simulated) parent node
			* @param parentTagName the parent's lowercase tag name
			* @returns true if a spec-compliant parser could produce this element
			*/
			const _checkMathMlNamespace = function _checkMathMlNamespace(tagName, parent, parentTagName) {
				if (parent.namespaceURI === HTML_NAMESPACE) return tagName === "math";
				if (parent.namespaceURI === SVG_NAMESPACE) return tagName === "math" && HTML_INTEGRATION_POINTS[parentTagName];
				return Boolean(ALL_MATHML_TAGS[tagName]);
			};
			/**
			* Namespace rules for an element in the HTML namespace.
			*
			* @param tagName the element's lowercase tag name
			* @param parent the (possibly simulated) parent node
			* @param parentTagName the parent's lowercase tag name
			* @returns true if a spec-compliant parser could produce this element
			*/
			const _checkHtmlNamespace = function _checkHtmlNamespace(tagName, parent, parentTagName) {
				if (parent.namespaceURI === SVG_NAMESPACE && !HTML_INTEGRATION_POINTS[parentTagName]) return false;
				if (parent.namespaceURI === MATHML_NAMESPACE && !MATHML_TEXT_INTEGRATION_POINTS[parentTagName]) return false;
				return !ALL_MATHML_TAGS[tagName] && (COMMON_SVG_AND_HTML_ELEMENTS[tagName] || !ALL_SVG_TAGS[tagName]);
			};
			/**
			* @param element a DOM element whose namespace is being checked
			* @returns Return false if the element has a
			*  namespace that a spec-compliant parser would never
			*  return. Return true otherwise.
			*/
			const _checkValidNamespace = function _checkValidNamespace(element) {
				let parent = getParentNode(element);
				if (!parent || !parent.tagName) parent = {
					namespaceURI: NAMESPACE,
					tagName: "template"
				};
				const tagName = stringToLowerCase(element.tagName);
				const parentTagName = stringToLowerCase(parent.tagName);
				if (!ALLOWED_NAMESPACES[element.namespaceURI]) return false;
				if (element.namespaceURI === SVG_NAMESPACE) return _checkSvgNamespace(tagName, parent, parentTagName);
				if (element.namespaceURI === MATHML_NAMESPACE) return _checkMathMlNamespace(tagName, parent, parentTagName);
				if (element.namespaceURI === HTML_NAMESPACE) return _checkHtmlNamespace(tagName, parent, parentTagName);
				if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && ALLOWED_NAMESPACES[element.namespaceURI]) return true;
				return false;
			};
			/**
			* _forceRemove
			*
			* @param node a DOM node
			*/
			const _forceRemove = function _forceRemove(node) {
				arrayPush(DOMPurify.removed, { element: node });
				try {
					getParentNode(node).removeChild(node);
				} catch (_) {
					remove(node);
					if (!getParentNode(node)) throw typeErrorCreate("a node selected for removal could not be detached from its tree and cannot be safely returned; refusing to sanitize in place");
				}
			};
			/**
			* _stripAttributeNode
			*
			* Remove a single Attr node case/namespace-exactly on an attribute-teardown
			* path. Name-based removeAttribute() ASCII-lowercases its lookup key for an
			* HTML element in an HTML document and so silently misses a case-preserved
			* handler (e.g. `ONERROR` off an XML/XHTML import) - the same defect
			* _removeAttribute() was fixed for, which a name-based call would reintroduce
			* on these IN_PLACE teardown paths. Unlike _removeAttribute this does not
			* record into DOMPurify.removed: the neutralize passes intentionally do not
			* book-keep. A clobbered/detached node falls back to best-effort name-based
			* removal.
			*
			* @param element the element to strip the attribute from
			* @param attribute the Attr node to remove
			* @param name the attribute's name, for the fallback path
			*/
			const _stripAttributeNode = function _stripAttributeNode(element, attribute, name) {
				try {
					element.removeAttributeNode(attribute);
				} catch (_) {
					try {
						element.removeAttribute(name);
					} catch (_) {}
				}
			};
			/**
			* _neutralizeRoot
			*
			* Fail-closed teardown of an in-place root after the sanitize walk aborts
			* (campaign-3 F2). An internal throw mid-walk — e.g. a page-registered
			* custom element's reaction detaches a node so `_forceRemove`'s deliberate
			* parentless guard throws, or any other re-entrant engine mutation — would
			* otherwise leave the caller's *live* tree half-sanitized, with everything
			* after the abort point still carrying its handlers. There is no safe way
			* to resume the walk (the tree mutated under us), so we strip the root bare:
			* remove every child and every attribute, then let the caller's catch see
			* the original error. Clobber-safe (cached `remove`/`childNodes`/`attributes`
			* getters; the root was already clobber-pre-flighted at the IN_PLACE entry).
			*
			* @param root the in-place root to empty
			*/
			const _neutralizeRoot = function _neutralizeRoot(root) {
				_neutralizeSubtree(root);
				const childNodes = getChildNodes(root);
				if (childNodes) {
					const snapshot = [];
					arrayForEach(childNodes, (child) => {
						arrayPush(snapshot, child);
					});
					arrayForEach(snapshot, (child) => {
						try {
							remove(child);
						} catch (_) {}
					});
				}
				const attributes = getAttributes(root);
				if (attributes) for (let i = attributes.length - 1; i >= 0; --i) {
					const attribute = attributes[i];
					const name = attribute && attribute.name;
					if (typeof name === "string") _stripAttributeNode(root, attribute, name);
				}
			};
			/**
			* _removeAttribute
			*
			* Name-based getAttributeNode()/removeAttribute() ASCII-lowercase their
			* lookup key for HTML elements in an HTML document, so they silently miss an
			* attribute whose stored qualified name still contains uppercase ASCII
			* letters. That happens when the node came from a case-preserving source
			* (an XML/XHTML document imported via importNode(), or createAttributeNS()),
			* where e.g. `ONERROR` survives the walk: the policy check lowercases to
			* `onerror` and rejects it, but `removeAttribute('ONERROR')` looks up
			* `onerror` and finds nothing. Remove the exact Attr node instead, which is
			* case- and namespace-exact, and fall back to name-based removal only when
			* the caller could not supply the node.
			*
			* @param name an Attribute name
			* @param element a DOM node
			* @param attr the exact Attr node to remove, when the caller has it
			*/
			const _removeAttribute = function _removeAttribute(name, element, attr) {
				if (!attr) try {
					attr = element.getAttributeNode(name);
				} catch (_) {
					attr = null;
				}
				arrayPush(DOMPurify.removed, {
					attribute: attr || null,
					from: element
				});
				try {
					if (attr) element.removeAttributeNode(attr);
					else element.removeAttribute(name);
				} catch (_) {
					try {
						element.removeAttribute(name);
					} catch (_) {}
				}
				if (name === "is") {
					if (RETURN_DOM || RETURN_DOM_FRAGMENT) try {
						_forceRemove(element);
					} catch (_) {}
					else try {
						element.setAttribute(name, "");
					} catch (_) {}
				}
			};
			/**
			* _stripDisallowedAttributes
			*
			* Removes every attribute the active configuration does not allow from a
			* single element, using the same allowlist as the main attribute pass (so
			* `on*` handlers go, but no `/^on/` blocklist is introduced). Used only to
			* neutralise nodes that are being discarded from an in-place tree.
			*
			* @param element the element to strip
			*/
			const _stripDisallowedAttributes = function _stripDisallowedAttributes(element) {
				const attributes = getAttributes(element);
				if (!attributes) return;
				for (let i = attributes.length - 1; i >= 0; --i) {
					const attribute = attributes[i];
					const name = attribute && attribute.name;
					if (typeof name !== "string" || ALLOWED_ATTR[transformCaseFunc(name)]) continue;
					_stripAttributeNode(element, attribute, name);
				}
			};
			/**
			* _neutralizeSubtree
			*
			* Completes the audit-5 F1 fix across every removal path. The KEEP_CONTENT
			* move-hoist neutralises only disallowed-tag removals; clobber, mXSS-canary,
			* namespace, comment, processing-instruction and KEEP_CONTENT:false removals
			* all drop their subtree wholesale via `_forceRemove`. On the IN_PLACE path
			* those dropped nodes are detached from the caller's LIVE tree but a
			* handler-bearing original among them (an `<img onerror>`/`<video>` that was
			* loading) keeps its queued resource event, which fires in page scope after
			* sanitize returns. This walks a removed subtree and strips every attribute
			* the active configuration does not allow — so `on*` handlers are cancelled
			* through the SAME allowlist that governs kept nodes, not a separate `/^on/`
			* blocklist. Run synchronously before sanitize returns, i.e. before any
			* queued event can fire. Hook-free by design: these nodes leave the output,
			* so firing attribute hooks for them would be surprising. Clobber-safe reads;
			* a doomed clobbered node may shadow `removeAttribute` (its own attributes are
			* irrelevant — it is discarded — while its non-clobbered descendants, e.g.
			* the `<img>`, are reached and scrubbed).
			*
			* @param root the root of a removed subtree to neutralise
			*/
			const _neutralizeSubtree = function _neutralizeSubtree(root) {
				const stack = [root];
				while (stack.length > 0) {
					const node = stack.pop();
					if (_readNodeType(node) === NODE_TYPE.element) _stripDisallowedAttributes(node);
					const childNodes = getChildNodes(node);
					if (childNodes) for (let i = childNodes.length - 1; i >= 0; --i) stack.push(childNodes[i]);
				}
			};
			/**
			* _neutralizePatchLinkage
			*
			* IN_PLACE entry pre-pass (declarative-partial-updates / streaming
			* hardening, https://github.com/WICG/declarative-partial-updates).
			*
			* The main walk strips patch linkage (`for`/`patchsrc`) and removes range
			* markers (PIs / markup comments) node-by-node, in document order, AS it
			* reaches each node. On a live in-place root that leaves a window: from the
			* moment the root is connected until the walk arrives at a given node, that
			* node's linkage is live. A patch applied on connection/stream can fire as
			* a microtask during the walk and inject or teleport an unsanitized DOM
			* range into a region the iterator has already passed and will not revisit,
			* so the post-return "tree is sanitized" contract is violated. Sweep the
			* whole tree once up front and sever every linkage before the walk begins,
			* closing that window.
			*
			* This CANNOT undo a patch that already fired before sanitize ran — that is
			* the irreducible "do not IN_PLACE a live-connected attacker tree" caveat —
			* but it closes everything from sanitize-start onward. Gated on SAFE_FOR_XML
			* to group with the rest of the declarative-partial-updates handling and
			* stay overridable, consistent with the codebase.
			*
			* Clobber-safe traversal (cached childNodes getter); per-node try/catch so a
			* clobbered root cannot defeat the sweep of its non-clobbered descendants.
			*
			* NOTE (pending real-Chrome confirmation, see test/declarative-patch-probe
			* .html Q1): this mirrors the existing policy of keeping `for` on
			* <label>/<output>. If the shipping feature can drive a patch through a
			* surviving `for`-on-label/output + `id` pair, this pre-pass and the
			* attribute check at _isBasicCustomElement's caller must additionally drop
			* that pair on the IN_PLACE path. Left as-is until the taxonomy is verified.
			*
			* @param root the in-place root to sweep
			*/
			/**
			* Central policy for declarative-partial-updates patch-linkage attributes,
			* shared by the _neutralizePatchLinkage pre-pass and _isValidAttribute so
			* the two sites cannot drift: `patchsrc` always links, `for` links
			* everywhere except on <label>/<output>, and the whole policy is gated on
			* SAFE_FOR_XML (see the rationale block in _isValidAttribute).
			*
			* @param lcName the transformCaseFunc'd attribute name
			* @param lcTag the transformCaseFunc'd tag name of the carrying element
			* @return true if the attribute is patch linkage and must be dropped
			*/
			const _isPatchLinkageAttribute = function _isPatchLinkageAttribute(lcName, lcTag) {
				if (!SAFE_FOR_XML) return false;
				if (lcName === "patchsrc") return true;
				return lcName === "for" && lcTag !== "label" && lcTag !== "output";
			};
			const _neutralizePatchLinkage = function _neutralizePatchLinkage(root) {
				if (!SAFE_FOR_XML) return;
				const stack = [root];
				while (stack.length > 0) {
					const node = stack.pop();
					const nodeType = _readNodeType(node);
					if (nodeType === NODE_TYPE.processingInstruction || nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, node.data)) {
						try {
							remove(node);
						} catch (_) {}
						continue;
					}
					if (nodeType === NODE_TYPE.element) {
						const element = node;
						const lcTag = transformCaseFunc(_readNodeName(node));
						try {
							if (element.hasAttribute && element.hasAttribute("patchsrc")) element.removeAttribute("patchsrc");
							if (element.hasAttribute && element.hasAttribute("for") && _isPatchLinkageAttribute("for", lcTag)) element.removeAttribute("for");
						} catch (_) {}
					}
					const childNodes = getChildNodes(node);
					if (childNodes) for (let i = childNodes.length - 1; i >= 0; --i) stack.push(childNodes[i]);
				}
			};
			/**
			* _initDocument
			*
			* @param dirty - a string of dirty markup
			* @return a DOM, filled with the dirty markup
			*/
			const _initDocument = function _initDocument(dirty) {
				let doc = null;
				let leadingWhitespace = null;
				if (FORCE_BODY) dirty = "<remove></remove>" + dirty;
				else {
					const matches = stringMatch(dirty, /^[\r\n\t ]+/);
					leadingWhitespace = matches && matches[0];
				}
				if (PARSER_MEDIA_TYPE === "application/xhtml+xml" && NAMESPACE === HTML_NAMESPACE) dirty = "<html xmlns=\"http://www.w3.org/1999/xhtml\"><head></head><body>" + dirty + "</body></html>";
				const dirtyPayload = trustedTypesPolicy ? _createTrustedHTML(dirty) : dirty;
				if (NAMESPACE === HTML_NAMESPACE) try {
					doc = new DOMParser().parseFromString(dirtyPayload, PARSER_MEDIA_TYPE);
				} catch (_) {}
				if (!doc || !doc.documentElement) {
					doc = implementation.createDocument(NAMESPACE, "template", null);
					try {
						doc.documentElement.innerHTML = IS_EMPTY_INPUT ? emptyHTML : dirtyPayload;
					} catch (_) {}
				}
				const body = doc.body || doc.documentElement;
				if (dirty && leadingWhitespace) body.insertBefore(document.createTextNode(leadingWhitespace), body.childNodes[0] || null);
				if (NAMESPACE === HTML_NAMESPACE) return getElementsByTagName.call(doc, WHOLE_DOCUMENT ? "html" : "body")[0];
				return WHOLE_DOCUMENT ? doc.documentElement : body;
			};
			/**
			* Creates a NodeIterator object that you can use to traverse filtered lists of nodes or elements in a document.
			*
			* @param root The root element or node to start traversing on.
			* @return The created NodeIterator
			*/
			const _createNodeIterator = function _createNodeIterator(root) {
				const doc = getOwnerDocument ? getOwnerDocument(root) : root.ownerDocument;
				return createNodeIterator.call(doc || root, root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_PROCESSING_INSTRUCTION | NodeFilter.SHOW_CDATA_SECTION, null);
			};
			/**
			* Replace template expression syntax (mustache, ERB, template
			* literal) with a space; shared by all SAFE_FOR_TEMPLATES scrub
			* sites. Order matters: mustache, then ERB, then template literal.
			*
			* @param value the string to scrub
			* @returns the scrubbed string
			*/
			const _stripTemplateExpressions = function _stripTemplateExpressions(value) {
				value = stringReplace(value, MUSTACHE_EXPR$1, " ");
				value = stringReplace(value, ERB_EXPR$1, " ");
				value = stringReplace(value, TMPLIT_EXPR$1, " ");
				return value;
			};
			/**
			* Strip template-engine expressions ({{...}}, ${...}, <%...%>) from the
			* character data of an element subtree. Used as the final safety net for
			* SAFE_FOR_TEMPLATES on every DOM-returning code path so that expressions
			* which only form after text-node normalization (e.g. fragments split across
			* stripped elements) cannot survive into a template-evaluating framework.
			*
			* Walks text/comment/CDATA/processing-instruction nodes and mutates `.data`
			* in place rather than round-tripping through innerHTML. This preserves
			* descendant node references (important for IN_PLACE callers), avoids a
			* serialize/reparse cycle, and reads literal character data — which means
			* `<%...%>` in text content matches the ERB regex against its real bytes
			* instead of the HTML-entity-escaped form innerHTML would produce.
			*
			* Attribute values are not visited here; SAFE_FOR_TEMPLATES handling for
			* attributes is performed during the per-node `_sanitizeAttributes` pass.
			*
			* @param node The root element whose character data should be scrubbed.
			*/
			const _scrubTemplateExpressions2 = function _scrubTemplateExpressions(node) {
				var _node$querySelectorAl;
				node.normalize();
				const doc = getOwnerDocument ? getOwnerDocument(node) : node.ownerDocument;
				const walker = createNodeIterator.call(doc || node, node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_CDATA_SECTION | NodeFilter.SHOW_PROCESSING_INSTRUCTION, null);
				let currentNode = walker.nextNode();
				while (currentNode) {
					currentNode.data = _stripTemplateExpressions(currentNode.data);
					currentNode = walker.nextNode();
				}
				const templates = (_node$querySelectorAl = node.querySelectorAll) === null || _node$querySelectorAl === void 0 ? void 0 : _node$querySelectorAl.call(node, "template");
				if (templates) arrayForEach(templates, (tmpl) => {
					if (_isDocumentFragment(tmpl.content)) _scrubTemplateExpressions2(tmpl.content);
				});
			};
			/**
			* _isClobbered
			*
			* Detect DOM-clobbering on HTMLFormElement nodes. Form is the only HTML
			* interface with [LegacyOverrideBuiltIns]; a descendant element with a
			* `name` attribute matching a prototype property shadows that property
			* on direct reads. We use this check at the IN_PLACE entry-point and
			* during attribute sanitization to refuse clobbered forms.
			*
			* @param element element to check for clobbering attacks
			* @return true if clobbered, false if safe
			*/
			const _isClobbered = function _isClobbered(element) {
				const realTagName = getNodeName ? getNodeName(element) : null;
				if (typeof realTagName !== "string") return false;
				if (transformCaseFunc(realTagName) !== "form") return false;
				return typeof element.nodeName !== "string" || typeof element.textContent !== "string" || typeof element.removeChild !== "function" || element.attributes !== getAttributes(element) || typeof element.removeAttribute !== "function" || typeof element.setAttribute !== "function" || typeof element.namespaceURI !== "string" || typeof element.insertBefore !== "function" || typeof element.hasChildNodes !== "function" || element.nodeType !== getNodeType(element) || element.childNodes !== getChildNodes(element);
			};
			/**
			* Checks whether the given value is a DocumentFragment from any realm.
			*
			* The realm-independent replacement reads `nodeType` through the cached
			* Node.prototype getter and compares to the DOCUMENT_FRAGMENT_NODE
			* constant (11). nodeType is a numeric value resolved from the node's
			* internal slot, identical across realms for the same kind of node.
			*
			* @param value object to check
			* @return true if value is a DocumentFragment-shaped node from any realm
			*/
			const _isDocumentFragment = function _isDocumentFragment(value) {
				if (!getNodeType || typeof value !== "object" || value === null) return false;
				try {
					return getNodeType(value) === NODE_TYPE.documentFragment;
				} catch (_) {
					return false;
				}
			};
			/**
			* Checks whether the given object is a DOM node, including nodes that
			* originate from a different window/realm (e.g. an iframe's
			* contentDocument). The previous `value instanceof Node` check was
			* realm-bound: nodes from a different window failed it, causing
			* sanitize() to silently stringify them and reset IN_PLACE to false,
			* returning the original node unsanitized. See GHSA-4w3q-35jp-p934.
			*
			* @param value object to check whether it's a DOM node
			* @return true if value is a DOM node from any realm
			*/
			const _isNode = function _isNode(value) {
				if (!getNodeType || typeof value !== "object" || value === null) return false;
				try {
					return typeof getNodeType(value) === "number";
				} catch (_) {
					return false;
				}
			};
			function _executeHooks(hooks, currentNode, data) {
				if (hooks.length === 0) return;
				arrayForEach(hooks, (hook) => {
					hook.call(DOMPurify, currentNode, data, CONFIG);
				});
			}
			/**
			* Structural-threat checks that condemn a node regardless of the
			* allowlists: mXSS via namespace confusion, risky CSS construction,
			* processing instructions, markup-bearing comments. Pure predicate;
			* the caller removes. Check order is load-bearing.
			*
			* @param currentNode the node to inspect
			* @param tagName the node's transformCaseFunc'd tag name
			* @return true if the node must be removed
			*/
			const _isUnsafeNode = function _isUnsafeNode(currentNode, tagName) {
				if (SAFE_FOR_XML && currentNode.hasChildNodes() && !_isNode(currentNode.firstElementChild) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.textContent) && regExpTest(ELEMENT_MARKUP_PROBE, currentNode.innerHTML)) return true;
				if (SAFE_FOR_XML && currentNode.namespaceURI === HTML_NAMESPACE && LITERAL_TEXT_ELEMENTS[tagName] && (_isNode(currentNode.firstElementChild) || typeof currentNode.textContent === "string" && regExpTest(LITERAL_TEXT_CLOSE[tagName], currentNode.textContent))) return true;
				if (currentNode.nodeType === NODE_TYPE.processingInstruction) return true;
				if (SAFE_FOR_XML && currentNode.nodeType === NODE_TYPE.comment && regExpTest(COMMENT_MARKUP_PROBE, currentNode.data)) return true;
				return false;
			};
			/**
			* Evaluate a CUSTOM_ELEMENT_HANDLING check (a RegExp or a predicate
			* function, per the validation in _parseConfig) against a name.
			* Additional arguments are forwarded to predicate functions - the
			* attributeNameCheck predicate receives the tag name as its second
			* argument. A null/absent check never matches.
			*
			* @param check the configured tagNameCheck / attributeNameCheck value
			* @param name the name to test
			* @param args extra arguments forwarded to a predicate function
			* @return true if the check matches the name
			*/
			const _matchesNameCheck = function _matchesNameCheck(check, name) {
				if (check instanceof RegExp) return regExpTest(check, name);
				if (check instanceof Function) {
					for (var _len = arguments.length, args = new Array(_len > 2 ? _len - 2 : 0), _key = 2; _key < _len; _key++) args[_key - 2] = arguments[_key];
					return Boolean(check(name, ...args));
				}
				return false;
			};
			/**
			* Handle a node whose tag is forbidden or not allowlisted: keep
			* allowed custom elements (false return exits _sanitizeElements
			* early - the namespace and fallback-tag removal checks are
			* intentionally skipped for kept custom elements), else hoist
			* content per KEEP_CONTENT and remove.
			*
			* A kept custom element is the ONLY case in which this function
			* returns false, so the caller uses that return value to run the
			* afterSanitizeElements hook on the kept element and keep the
			* element-hook lifecycle consistent with normal allowlisted
			* elements (GHSA-c2j3-45gr-mqc4).
			*
			* @param currentNode the disallowed node
			* @param tagName the node's transformCaseFunc'd tag name
			* @return true if the node was removed, false if kept
			*/
			const _sanitizeDisallowedNode = function _sanitizeDisallowedNode(currentNode, tagName, root) {
				if (!FORBID_TAGS[tagName] && _isBasicCustomElement(tagName) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, tagName)) return false;
				if (KEEP_CONTENT && !FORBID_CONTENTS[tagName]) {
					const parentNode = getParentNode(currentNode);
					const childNodes = getChildNodes(currentNode);
					if (childNodes && parentNode) {
						const childCount = childNodes.length;
						for (let i = childCount - 1; i >= 0; --i) {
							const hoisted = currentNode === root ? cloneNode(childNodes[i], true) : childNodes[i];
							parentNode.insertBefore(hoisted, getNextSibling(currentNode));
						}
					}
				}
				_forceRemove(currentNode);
				return true;
			};
			/**
			* Fork a hook-mutable allowlist off its shared binding the first time a
			* (possibly lazily-installed) uponSanitize* hook is about to see it, so the
			* hook cannot widen the per-instance default or the setConfig binding by
			* reference and leak past the call. Returns the set unchanged once it is
			* already call-local, so repeated calls across elements are idempotent.
			*
			* @param hookList the uponSanitize* hook array for this event
			* @param set the current ALLOWED_TAGS / ALLOWED_ATTR binding
			* @param defaultSet the per-instance DEFAULT_ALLOWED_* constant
			* @param setConfigSet the captured setConfig() binding, or null
			* @return a call-local clone if a hook is present and set is still shared,
			*   else set unchanged
			*/
			const _forkSharedAllowlist = function _forkSharedAllowlist(hookList, set, defaultSet, setConfigSet) {
				if (hookList.length === 0) return set;
				return set === defaultSet || set === setConfigSet ? clone(set) : set;
			};
			/**
			* Shared guard for a node that a hook has detached from the walk tree,
			* used after each element-hook site in _sanitizeElements. Detaching is a
			* long-standing user pattern (issue #469; draw.io-style foreignObject
			* filtering). Per the cached, unclobberable parentNode getter the node is
			* genuinely out of the tree, so it can reach neither the serialized
			* output nor an IN_PLACE live tree; treat it as removed and stop
			* processing it. Without this guard, the unsafe-node / namespace checks
			* would call _forceRemove on a parentless node and hit the REPORT-3
			* fail-closed throw — which exists for nodes DOMPurify wants gone but
			* *cannot* detach (clobbered / parentless roots), the opposite of a node
			* that is already safely gone. The walk root is exempt: a detached
			* IN_PLACE root is legitimate input and must still be fully sanitized,
			* and a kill-decision on it must keep hitting the REPORT-3 throw.
			*
			* Nodes detached by hooks stay the hook's responsibility for placement:
			* they are not recorded in DOMPurify.removed, so the post-walk IN_PLACE
			* pass (which iterates DOMPurify.removed) does not reach them. But a
			* hook-detached subtree can still hold a queued resource-event handler -
			* e.g. an <img onload> that began loading when the caller built the live
			* tree - which fires in page scope after sanitize returns even though the
			* handler never reached the returned tree. That is the audit-5 F1 hazard,
			* and the documented node.remove() hook pattern walks straight into it.
			* So on the IN_PLACE path we neutralize the detached subtree inline,
			* stripping its non-allow-listed attributes before returning, exactly as
			* the post-walk pass does for _forceRemove'd subtrees.
			*
			* @param currentNode the node a hook may have detached
			* @param root the current walk root
			* @return true if the node is detached and now handled, false otherwise
			*/
			const _handleHookDetachedNode = function _handleHookDetachedNode(currentNode, root) {
				if (currentNode === root || getParentNode(currentNode) !== null) return false;
				if (IN_PLACE) _neutralizeSubtree(currentNode);
				return true;
			};
			/**
			* _sanitizeElements
			*
			* @protect nodeName
			* @protect textContent
			* @protect removeChild
			* @param currentNode to check for permission to exist
			* @return true if node was killed, false if left alive
			*/
			const _sanitizeElements = function _sanitizeElements(currentNode, root) {
				_executeHooks(hooks.beforeSanitizeElements, currentNode, null);
				if (_handleHookDetachedNode(currentNode, root)) return true;
				if (_isClobbered(currentNode)) {
					_forceRemove(currentNode);
					return true;
				}
				const tagName = transformCaseFunc(_readNodeName(currentNode));
				ALLOWED_TAGS = _forkSharedAllowlist(hooks.uponSanitizeElement, ALLOWED_TAGS, DEFAULT_ALLOWED_TAGS, SET_CONFIG_ALLOWED_TAGS);
				_executeHooks(hooks.uponSanitizeElement, currentNode, {
					tagName,
					allowedTags: ALLOWED_TAGS
				});
				if (_handleHookDetachedNode(currentNode, root)) return true;
				if (_isUnsafeNode(currentNode, tagName)) {
					_forceRemove(currentNode);
					return true;
				}
				if (FORBID_TAGS[tagName] || !(EXTRA_ELEMENT_HANDLING.tagCheck instanceof Function && EXTRA_ELEMENT_HANDLING.tagCheck(tagName)) && !ALLOWED_TAGS[tagName]) {
					const removed = _sanitizeDisallowedNode(currentNode, tagName, root);
					if (removed === false) _executeHooks(hooks.afterSanitizeElements, currentNode, null);
					return removed;
				}
				if (_readNodeType(currentNode) === NODE_TYPE.element && !_checkValidNamespace(currentNode)) {
					_forceRemove(currentNode);
					return true;
				}
				if ((tagName === "noscript" || tagName === "noembed" || tagName === "noframes") && regExpTest(FALLBACK_TAG_CLOSE, currentNode.innerHTML)) {
					_forceRemove(currentNode);
					return true;
				}
				if (SAFE_FOR_TEMPLATES && currentNode.nodeType === NODE_TYPE.text) {
					const content = _stripTemplateExpressions(currentNode.textContent);
					if (currentNode.textContent !== content) {
						arrayPush(DOMPurify.removed, { element: currentNode.cloneNode() });
						currentNode.textContent = content;
					}
				}
				_executeHooks(hooks.afterSanitizeElements, currentNode, null);
				return false;
			};
			/**
			* _isValidAttribute
			*
			* @param lcTag Lowercase tag name of containing element.
			* @param lcName Lowercase attribute name.
			* @param value Attribute value.
			* @return Returns true if `value` is valid, otherwise false.
			*/
			const _isValidAttribute = function _isValidAttribute(lcTag, lcName, value) {
				if (FORBID_ATTR[lcName]) return false;
				if (_isPatchLinkageAttribute(lcName, lcTag)) return false;
				if (SANITIZE_DOM && (lcName === "id" || lcName === "name") && (value in document || value in formElement)) return false;
				const nameIsPermitted = ALLOWED_ATTR[lcName] || EXTRA_ELEMENT_HANDLING.attributeCheck instanceof Function && EXTRA_ELEMENT_HANDLING.attributeCheck(lcName, lcTag);
				if (ALLOW_DATA_ATTR && regExpTest(DATA_ATTR$1, lcName)) return true;
				if (ALLOW_ARIA_ATTR && regExpTest(ARIA_ATTR$1, lcName)) return true;
				if (!nameIsPermitted) return _isBasicCustomElement(lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, lcTag) && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.attributeNameCheck, lcName, lcTag) || lcName === "is" && CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements && _matchesNameCheck(CUSTOM_ELEMENT_HANDLING.tagNameCheck, value);
				if (URI_SAFE_ATTRIBUTES[lcName]) return true;
				if (regExpTest(IS_ALLOWED_URI$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) return true;
				if ((lcName === "src" || lcName === "xlink:href" || lcName === "href") && lcTag !== "script" && stringIndexOf(value, "data:") === 0 && DATA_URI_TAGS[lcTag]) return true;
				if (ALLOW_UNKNOWN_PROTOCOLS && !regExpTest(IS_SCRIPT_OR_DATA$1, stringReplace(value, ATTR_WHITESPACE$1, ""))) return true;
				return !value;
			};
			const RESERVED_CUSTOM_ELEMENT_NAMES = addToSet({}, [
				"annotation-xml",
				"color-profile",
				"font-face",
				"font-face-format",
				"font-face-name",
				"font-face-src",
				"font-face-uri",
				"missing-glyph"
			]);
			/**
			* _isBasicCustomElement
			* checks if at least one dash is included in tagName, and it's not the first char
			* for more sophisticated checking see https://github.com/sindresorhus/validate-element-name
			*
			* @param tagName name of the tag of the node to sanitize
			* @returns Returns true if the tag name meets the basic criteria for a custom element, otherwise false.
			*/
			const _isBasicCustomElement = function _isBasicCustomElement(tagName) {
				return !RESERVED_CUSTOM_ELEMENT_NAMES[stringToLowerCase(tagName)] && regExpTest(CUSTOM_ELEMENT$1, tagName);
			};
			/**
			* Wrap an attribute value in the matching Trusted Types object when
			* the active policy requires it. Namespaced attributes pass through
			* unchanged (no TT support yet, see
			* https://bugs.chromium.org/p/chromium/issues/detail?id=1305293).
			*
			* @param lcTag lowercase tag name of the containing element
			* @param lcName lowercase attribute name
			* @param namespaceURI the attribute's namespace, if any
			* @param value the attribute value to wrap
			* @return the value, wrapped when Trusted Types demand it
			*/
			const _applyTrustedTypesToAttribute = function _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value) {
				if (trustedTypesPolicy && typeof trustedTypes === "object" && typeof trustedTypes.getAttributeType === "function" && !namespaceURI) switch (trustedTypes.getAttributeType(lcTag, lcName)) {
					case "TrustedHTML": return _createTrustedHTML(value);
					case "TrustedScriptURL": return _createTrustedScriptURL(value);
				}
				return value;
			};
			/**
			* Write a modified attribute value back onto the element. On
			* success, re-probe for clobbering introduced by the new value and
			* remove the element when found; otherwise pop the removal entry
			* recorded by the earlier _removeAttribute (long-standing pairing
			* with the SANITIZE_NAMED_PROPS path - do not "fix" casually). On
			* failure, remove the attribute instead.
			*
			* @param currentNode the element carrying the attribute
			* @param name the attribute name as present on the element
			* @param namespaceURI the attribute's namespace, if any
			* @param value the new attribute value
			*/
			const _setAttributeValue = function _setAttributeValue(currentNode, name, namespaceURI, value) {
				try {
					if (namespaceURI) currentNode.setAttributeNS(namespaceURI, name, value);
					else currentNode.setAttribute(name, value);
					if (_isClobbered(currentNode)) _forceRemove(currentNode);
					else arrayPop(DOMPurify.removed);
				} catch (_) {
					_removeAttribute(name, currentNode);
				}
			};
			/**
			* _sanitizeAttributes
			*
			* @protect attributes
			* @protect nodeName
			* @protect removeAttribute
			* @protect setAttribute
			*
			* @param currentNode to sanitize
			*/
			const _sanitizeAttributes = function _sanitizeAttributes(currentNode) {
				_executeHooks(hooks.beforeSanitizeAttributes, currentNode, null);
				const attributes = currentNode.attributes;
				if (!attributes || _isClobbered(currentNode)) return;
				ALLOWED_ATTR = _forkSharedAllowlist(hooks.uponSanitizeAttribute, ALLOWED_ATTR, DEFAULT_ALLOWED_ATTR, SET_CONFIG_ALLOWED_ATTR);
				const hookEvent = {
					attrName: "",
					attrValue: "",
					keepAttr: true,
					allowedAttributes: ALLOWED_ATTR,
					forceKeepAttr: void 0
				};
				let l = attributes.length;
				const lcTag = transformCaseFunc(currentNode.nodeName);
				while (l--) {
					const attr = attributes[l];
					const name = attr.name, namespaceURI = attr.namespaceURI, attrValue = attr.value;
					const lcName = transformCaseFunc(name);
					const initValue = attrValue;
					let value = name === "value" ? initValue : stringTrim(initValue);
					hookEvent.attrName = lcName;
					hookEvent.attrValue = value;
					hookEvent.keepAttr = true;
					hookEvent.forceKeepAttr = void 0;
					_executeHooks(hooks.uponSanitizeAttribute, currentNode, hookEvent);
					value = hookEvent.attrValue;
					if (SANITIZE_NAMED_PROPS && (lcName === "id" || lcName === "name") && stringIndexOf(value, SANITIZE_NAMED_PROPS_PREFIX) !== 0) {
						_removeAttribute(name, currentNode, attr);
						value = SANITIZE_NAMED_PROPS_PREFIX + value;
					}
					if (SAFE_FOR_XML && regExpTest(/((--!?|])>)|<\/(style|script|title|xmp|textarea|noscript|iframe|noembed|noframes)/i, value)) {
						_removeAttribute(name, currentNode, attr);
						continue;
					}
					if (lcName === "attributename" && stringMatch(value, "href")) {
						_removeAttribute(name, currentNode, attr);
						continue;
					}
					if (hookEvent.forceKeepAttr) continue;
					if (!hookEvent.keepAttr) {
						_removeAttribute(name, currentNode, attr);
						continue;
					}
					if (!ALLOW_SELF_CLOSE_IN_ATTR && regExpTest(SELF_CLOSING_TAG, value)) {
						_removeAttribute(name, currentNode, attr);
						continue;
					}
					if (SAFE_FOR_TEMPLATES) value = _stripTemplateExpressions(value);
					if (!_isValidAttribute(lcTag, lcName, value)) {
						_removeAttribute(name, currentNode, attr);
						continue;
					}
					value = _applyTrustedTypesToAttribute(lcTag, lcName, namespaceURI, value);
					if (value !== initValue) _setAttributeValue(currentNode, name, namespaceURI, value);
				}
				_executeHooks(hooks.afterSanitizeAttributes, currentNode, null);
			};
			/**
			* _sanitizeShadowDOM
			*
			* @param fragment to iterate over recursively
			*/
			const _sanitizeShadowDOM2 = function _sanitizeShadowDOM(fragment) {
				let shadowNode = null;
				const shadowIterator = _createNodeIterator(fragment);
				_executeHooks(hooks.beforeSanitizeShadowDOM, fragment, null);
				while (shadowNode = shadowIterator.nextNode()) {
					_executeHooks(hooks.uponSanitizeShadowNode, shadowNode, null);
					_sanitizeElements(shadowNode, fragment);
					_sanitizeAttributes(shadowNode);
					if (_isDocumentFragment(shadowNode.content)) _sanitizeShadowDOM2(shadowNode.content);
					if (_readNodeType(shadowNode) === NODE_TYPE.element) {
						const innerSr = getShadowRoot(shadowNode);
						if (_isDocumentFragment(innerSr)) {
							_sanitizeAttachedShadowRoots(innerSr);
							_sanitizeShadowDOM2(innerSr);
						}
					}
				}
				_executeHooks(hooks.afterSanitizeShadowDOM, fragment, null);
			};
			/**
			* _sanitizeAttachedShadowRoots
			*
			* Walks `root` and feeds every attached shadow root we encounter into
			* the existing _sanitizeShadowDOM pipeline. The default node iterator
			* does not descend into shadow trees, so nodes inside an attached
			* shadow root would otherwise be skipped entirely.
			*
			* Two real input paths put attached shadow roots in front of us:
			*   1. IN_PLACE on a DOM node that already has shadow roots attached.
			*   2. DOM-node input where importNode(dirty, true) deep-clones the
			*      shadow root because it was created with `clonable: true`.
			*
			* This pass runs once, up front, so the main iteration loop (and the
			* existing _sanitizeShadowDOM template-content recursion) stay
			* untouched — string-input paths are not affected.
			*
			* @param root the subtree root to walk for attached shadow roots
			*/
			const _sanitizeAttachedShadowRoots = function _sanitizeAttachedShadowRoots(root) {
				const stack = [{
					node: root,
					shadow: null
				}];
				while (stack.length > 0) {
					const item = stack.pop();
					if (item.shadow) {
						_sanitizeShadowDOM2(item.shadow);
						continue;
					}
					const node = item.node;
					const isElement = _readNodeType(node) === NODE_TYPE.element;
					const childNodes = getChildNodes(node);
					if (childNodes) for (let i = childNodes.length - 1; i >= 0; --i) stack.push({
						node: childNodes[i],
						shadow: null
					});
					if (isElement) {
						const rootName = getNodeName ? getNodeName(node) : null;
						if (typeof rootName === "string" && transformCaseFunc(rootName) === "template") {
							const content = node.content;
							if (_isDocumentFragment(content)) stack.push({
								node: content,
								shadow: null
							});
						}
					}
					if (isElement) {
						const sr = getShadowRoot(node);
						if (_isDocumentFragment(sr)) stack.push({
							node: null,
							shadow: sr
						}, {
							node: sr,
							shadow: null
						});
					}
				}
			};
			DOMPurify.sanitize = function(dirty) {
				let cfg = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
				let body = null;
				let importedNode = null;
				let currentNode = null;
				let returnNode = null;
				IS_EMPTY_INPUT = !dirty;
				if (IS_EMPTY_INPUT) dirty = "<!-->";
				if (typeof dirty !== "string" && !_isNode(dirty)) {
					dirty = stringifyValue(dirty);
					if (typeof dirty !== "string") throw typeErrorCreate("dirty is not a string, aborting");
				}
				if (!DOMPurify.isSupported) return dirty;
				if (SET_CONFIG) {
					ALLOWED_TAGS = SET_CONFIG_ALLOWED_TAGS;
					ALLOWED_ATTR = SET_CONFIG_ALLOWED_ATTR;
				} else _parseConfig(cfg);
				if (hooks.uponSanitizeElement.length > 0 || hooks.uponSanitizeAttribute.length > 0) ALLOWED_TAGS = clone(ALLOWED_TAGS);
				if (hooks.uponSanitizeAttribute.length > 0) ALLOWED_ATTR = clone(ALLOWED_ATTR);
				DOMPurify.removed = [];
				const inPlace = IN_PLACE && typeof dirty !== "string" && _isNode(dirty);
				if (inPlace) {
					_neutralizePatchLinkage(dirty);
					const nn = _readNodeName(dirty);
					if (typeof nn === "string") {
						const tagName = transformCaseFunc(nn);
						if (!ALLOWED_TAGS[tagName] || FORBID_TAGS[tagName]) {
							_neutralizeRoot(dirty);
							throw typeErrorCreate("root node is forbidden and cannot be sanitized in-place");
						}
					}
					if (_isClobbered(dirty)) {
						_neutralizeRoot(dirty);
						throw typeErrorCreate("root node is clobbered and cannot be sanitized in-place");
					}
					try {
						_sanitizeAttachedShadowRoots(dirty);
					} catch (error) {
						_neutralizeRoot(dirty);
						throw error;
					}
				} else if (_isNode(dirty)) {
					body = _initDocument("<!---->");
					importedNode = body.ownerDocument.importNode(dirty, true);
					if (importedNode.nodeType === NODE_TYPE.element && importedNode.nodeName === "BODY") body = importedNode;
					else if (importedNode.nodeName === "HTML") body = importedNode;
					else body.appendChild(importedNode);
					_sanitizeAttachedShadowRoots(importedNode);
				} else {
					if (!RETURN_DOM && !SAFE_FOR_TEMPLATES && !WHOLE_DOCUMENT && dirty.indexOf("<") === -1) return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(dirty) : dirty;
					body = _initDocument(dirty);
					if (!body) return RETURN_DOM ? null : RETURN_TRUSTED_TYPE ? emptyHTML : "";
				}
				if (body && FORCE_BODY) _forceRemove(body.firstChild);
				const walkRoot = inPlace ? dirty : body;
				try {
					const nodeIterator = _createNodeIterator(walkRoot);
					while (currentNode = nodeIterator.nextNode()) {
						_sanitizeElements(currentNode, walkRoot);
						_sanitizeAttributes(currentNode);
						if (_isDocumentFragment(currentNode.content)) _sanitizeShadowDOM2(currentNode.content);
					}
				} catch (error) {
					if (inPlace) {
						_neutralizeRoot(dirty);
						arrayForEach(DOMPurify.removed, (entry) => {
							if (entry.element) _neutralizeSubtree(entry.element);
						});
					}
					throw error;
				}
				if (inPlace) {
					arrayForEach(DOMPurify.removed, (entry) => {
						if (entry.element) _neutralizeSubtree(entry.element);
					});
					if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(dirty);
					return dirty;
				}
				if (RETURN_DOM) {
					if (SAFE_FOR_TEMPLATES) _scrubTemplateExpressions2(body);
					if (RETURN_DOM_FRAGMENT) {
						returnNode = createDocumentFragment.call(body.ownerDocument);
						while (body.firstChild) returnNode.appendChild(body.firstChild);
					} else returnNode = body;
					if (ALLOWED_ATTR.shadowroot || ALLOWED_ATTR.shadowrootmode) returnNode = importNode.call(originalDocument, returnNode, true);
					return returnNode;
				}
				let serializedHTML = WHOLE_DOCUMENT ? body.outerHTML : body.innerHTML;
				if (WHOLE_DOCUMENT && ALLOWED_TAGS["!doctype"] && body.ownerDocument && body.ownerDocument.doctype && body.ownerDocument.doctype.name && regExpTest(DOCTYPE_NAME, body.ownerDocument.doctype.name)) serializedHTML = "<!DOCTYPE " + body.ownerDocument.doctype.name + ">\n" + serializedHTML;
				if (SAFE_FOR_TEMPLATES) serializedHTML = _stripTemplateExpressions(serializedHTML);
				return trustedTypesPolicy && RETURN_TRUSTED_TYPE ? _createTrustedHTML(serializedHTML) : serializedHTML;
			};
			DOMPurify.setConfig = function() {
				let cfg = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
				_parseConfig(cfg);
				SET_CONFIG = true;
				SET_CONFIG_ALLOWED_TAGS = ALLOWED_TAGS;
				SET_CONFIG_ALLOWED_ATTR = ALLOWED_ATTR;
			};
			DOMPurify.clearConfig = function() {
				CONFIG = null;
				SET_CONFIG = false;
				SET_CONFIG_ALLOWED_TAGS = null;
				SET_CONFIG_ALLOWED_ATTR = null;
				trustedTypesPolicy = defaultTrustedTypesPolicy;
				emptyHTML = "";
			};
			DOMPurify.isValidAttribute = function(tag, attr, value) {
				if (!CONFIG) _parseConfig({});
				const lcTag = transformCaseFunc(tag);
				const lcName = transformCaseFunc(attr);
				return _isValidAttribute(lcTag, lcName, value);
			};
			DOMPurify.addHook = function(entryPoint, hookFunction) {
				if (typeof hookFunction !== "function") return;
				if (!objectHasOwnProperty(hooks, entryPoint)) return;
				arrayPush(hooks[entryPoint], hookFunction);
			};
			DOMPurify.removeHook = function(entryPoint, hookFunction) {
				if (!objectHasOwnProperty(hooks, entryPoint)) return;
				if (hookFunction !== void 0) {
					const index = arrayLastIndexOf(hooks[entryPoint], hookFunction);
					return index === -1 ? void 0 : arraySplice(hooks[entryPoint], index, 1)[0];
				}
				return arrayPop(hooks[entryPoint]);
			};
			DOMPurify.removeHooks = function(entryPoint) {
				if (!objectHasOwnProperty(hooks, entryPoint)) return;
				hooks[entryPoint] = [];
			};
			DOMPurify.removeAllHooks = function() {
				hooks = _createHooksMap();
			};
			return DOMPurify;
		}
		var purify = createDOMPurify();
		//#endregion
		//#region src/client/markdown.ts
		/**
		* v5.1 富渲染管线：
		* - 浏览器：marked（带 wikilink 内联扩展，解析期直接产出锚点 token）→ DOMPurify 白名单净化
		* - Node（测试/SSR 等无 window 环境）：先 HTML 转义再白名单转换的回退渲染器（覆盖本插件用到的语法集）
		*
		* v5.0 → v5.1 教训：此前用 `\u0000WIKILINK<i>\u0000` 占位符过 marked 再在净化后还原，
		* 但 DOMPurify 内部经历 DOM parse → serialize，HTML 规范把文本中的 U+0000 替换为
		* U+FFFD，占位符永不匹配 → wikilink 锚点从未生成（浏览器上双链点不了）。
		* 现改为 marked 内联扩展在 token 层产出最终锚点；代码块/行内代码天然不参与 inline
		* 扩展，也顺带修掉了「代码块里的 [[x]] 被误转成链接」的回归。
		*
		* 安全模式不变：任何进入 dangerouslySetInnerHTML 的输出都经过「转义/净化 + 白名单」，
		* 锚点 href 固定 '#'，无 javascript: 注入面。
		*/
		function escapeHtml(s) {
			return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
		}
		const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
		/** wikilink 目标 id 只允许 SAFE_ID 字符集，杜绝把属性玩出花 */
		const SAFE_ID = /^[a-zA-Z0-9\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff-]*$/;
		f.use({ extensions: [{
			name: "wikilink",
			level: "inline",
			start(src) {
				return src.indexOf("[[");
			},
			tokenizer(src) {
				const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/.exec(src);
				if (!m) return void 0;
				const id = m[1].trim();
				const label = (m[2] ?? "").trim() || id;
				if (!SAFE_ID.test(id)) return void 0;
				return {
					type: "wikilink",
					raw: m[0],
					id,
					label
				};
			},
			renderer(token) {
				return `<a href="#" data-wikilink="${escapeHtml(token.id)}">${escapeHtml(token.label)}</a>`;
			}
		}] });
		/** 仅 marked（含 wikilink 扩展），不净化。测试与浏览器路径共用的解析段。 */
		function parseWithMarked(text) {
			return f.parse(text, {
				async: false,
				gfm: true,
				breaks: false
			});
		}
		/** DOMPurify 白名单：markdown 呈现所需标签 + wikilink 锚点的 data 属性。
		*  img 的 src/alt 必须保留（笔记内嵌图可用）；危险协议由 DOMPurify 默认 URI 规则拦截（javascript: 等被剥）。
		*  导出供测试做契约断言（Node 无 DOM 测不了 DOMPurify 行为，但能锁住白名单配置）。 */
		const PURIFY_CONFIG = {
			ALLOWED_TAGS: [
				"h1",
				"h2",
				"h3",
				"h4",
				"h5",
				"h6",
				"p",
				"br",
				"hr",
				"strong",
				"em",
				"del",
				"s",
				"ul",
				"ol",
				"li",
				"input",
				"blockquote",
				"pre",
				"code",
				"table",
				"thead",
				"tbody",
				"tr",
				"th",
				"td",
				"a",
				"span",
				"div",
				"img"
			],
			ALLOWED_ATTR: [
				"href",
				"data-wikilink",
				"type",
				"checked",
				"disabled",
				"class",
				"align",
				"src",
				"alt"
			]
		};
		/** 已转义文本上的 wikilink → 锚点（回退渲染器行内使用）。 */
		function renderWikilinks(escapedText) {
			return escapedText.replace(WIKILINK_RE, (_m, target, alias) => {
				const id = target.trim();
				const label = (alias ?? "").trim() || id;
				if (!SAFE_ID.test(id)) return _m;
				return `<a href="#" data-wikilink="${escapeHtml(id)}">${escapeHtml(label)}</a>`;
			});
		}
		function renderMarkdown(text) {
			if (typeof window !== "undefined" && purify.isSupported) return purify.sanitize(parseWithMarked(text), PURIFY_CONFIG);
			return renderFallback(text);
		}
		/** Node 无 DOM 的回退渲染器：先转义后白名单（与 v4 安全模式同源）。 */
		function renderFallback(text) {
			const escaped = escapeHtml(text);
			const blocks = [];
			const lines = escaped.replace(/```([\s\S]*?)```/g, (_m, code) => {
				blocks.push(`<pre><code>${code}</code></pre>`);
				return `\u0001BLOCK${blocks.length - 1}\u0001`;
			}).split("\n");
			const out = [];
			let inUl = false, inOl = false, inQuote = false;
			const closeLists = () => {
				if (inUl) {
					out.push("</ul>");
					inUl = false;
				}
				if (inOl) {
					out.push("</ol>");
					inOl = false;
				}
			};
			const closeQuote = () => {
				if (inQuote) {
					out.push("</blockquote>");
					inQuote = false;
				}
			};
			const flushTable = (rows) => {
				if (!rows.length) return;
				const cells = (row) => row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
				const header = cells(rows[0]);
				const bodyRows = rows[2] !== void 0 ? rows.slice(2) : [];
				out.push("<table><thead><tr>" + header.map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>");
				for (const r of bodyRows) out.push("<tr>" + cells(r).map((c) => `<td>${c}</td>`).join("") + "</tr>");
				out.push("</tbody></table>");
			};
			let tableRows = [];
			for (const rawLine of lines) {
				const line = rawLine.trimEnd();
				if (/^\|.*\|$/.test(line.trim())) {
					tableRows.push(line.trim());
					continue;
				}
				flushTable(tableRows);
				tableRows = [];
				const m = line.match(/^(#{1,6})\s+(.*)$/);
				if (m) {
					closeLists();
					closeQuote();
					const level = Math.min(m[1].length, 6);
					out.push(`<h${level}>${renderWikilinks(inline(m[2] ?? ""))}</h${level}>`);
					continue;
				}
				if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
					closeLists();
					closeQuote();
					out.push("<hr>");
					continue;
				}
				if (line.startsWith("&gt; ") || line.startsWith("&gt;")) {
					closeLists();
					if (!inQuote) {
						out.push("<blockquote>");
						inQuote = true;
					}
					out.push(`<p>${renderWikilinks(inline(line.replace(/^&gt;\s?/, "")))}</p>`);
					continue;
				}
				closeQuote();
				const task = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
				if (task) {
					if (inOl) {
						out.push("</ol>");
						inOl = false;
					}
					if (!inUl) {
						out.push("<ul>");
						inUl = true;
					}
					const checked = task[1].toLowerCase() === "x";
					out.push(`<li><input type="checkbox" disabled${checked ? " checked" : ""}> ${renderWikilinks(inline(task[2]))}</li>`);
					continue;
				}
				if (line.startsWith("- ") || line.startsWith("* ")) {
					if (inOl) {
						out.push("</ol>");
						inOl = false;
					}
					if (!inUl) {
						out.push("<ul>");
						inUl = true;
					}
					out.push(`<li>${renderWikilinks(inline(line.slice(2)))}</li>`);
					continue;
				}
				const ol = line.match(/^\d+\.\s+(.*)$/);
				if (ol) {
					if (inUl) {
						out.push("</ul>");
						inUl = false;
					}
					if (!inOl) {
						out.push("<ol>");
						inOl = true;
					}
					out.push(`<li>${renderWikilinks(inline(ol[1]))}</li>`);
					continue;
				}
				closeLists();
				if (line === "") {
					out.push("");
					continue;
				}
				const block = line.match(/^\u0001BLOCK(\d+)\u0001$/);
				if (block) {
					out.push(blocks[Number(block[1])]);
					continue;
				}
				out.push(`<p>${renderWikilinks(inline(line))}</p>`);
			}
			flushTable(tableRows);
			closeLists();
			closeQuote();
			return out.join("\n");
		}
		/** 行内语法：图片、代码、粗体、斜体、删除线。输入已转义（wikilink 由 renderWikilinks 处理）。
		*  图片与浏览器路径的 DOMPurify 白名单同构：仅放行 http(s)/data:image 与无协议的相对路径，
		*  其他协议（javascript: 等）剥成纯 alt 文本。 */
		const SAFE_IMG_SRC_RE = /^(https?:|data:image\/)/i;
		function inline(s) {
			return s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_m, alt, url) => {
				const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(url);
				return SAFE_IMG_SRC_RE.test(url) || !hasScheme ? `<img src="${url}" alt="${alt}">` : alt;
			}).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>").replace(/~~([^~]+)~~/g, "<del>$1</del>");
		}
		//#endregion
		//#region src/client/NoteView.tsx
		/**
		* v5 笔记视图（设计 v2）：预览 / 源码双态。
		* - 预览：富 markdown 渲染（renderMarkdown），wikilink 点击经事件委托上抛 onNavigate
		* - 源码：磁盘原文（含 frontmatter）可编辑 + 复制 + 保存（错误就地展示）
		* 断链提示由父级（持有页面索引的 NoteWorkbench）判定后经 brokenLink prop 下传。
		*/
		function NoteView({ note, brokenLink, onNavigate, onSaved }) {
			const [mode, setMode] = (0, react.useState)("preview");
			const [content, setContent] = (0, react.useState)("");
			const [raw, setRaw] = (0, react.useState)("");
			const [dirty, setDirty] = (0, react.useState)(false);
			const [copied, setCopied] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let cancelled = false;
				setError(null);
				setNotice(null);
				setDirty(false);
				setMode("preview");
				fetch(`/api/obsidian-wiki/page?id=${encodeURIComponent(note.id)}&category=${encodeURIComponent(note.category)}`).then((r) => r.json()).then((data) => {
					if (cancelled) return;
					if (data.error) setError(data.error);
					else setContent(renderMarkdown(data.page?.body ?? ""));
				}).catch((e) => {
					if (!cancelled) setError(String(e));
				});
				fetchRawPage(note.id, note.category).then((r) => {
					if (!cancelled) setRaw(r);
				}).catch(() => {});
				return () => {
					cancelled = true;
				};
			}, [note.id, note.category]);
			const onContentClick = (e) => {
				const target = e.target.closest("a[data-wikilink]");
				if (!target) return;
				e.preventDefault();
				const id = target.getAttribute("data-wikilink") ?? "";
				if (id) onNavigate(id);
			};
			const copy = async () => {
				try {
					await navigator.clipboard.writeText(raw);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch {
					setNotice("复制失败：浏览器剪贴板不可用");
				}
			};
			const save = async () => {
				setSaving(true);
				setError(null);
				setNotice(null);
				try {
					await saveRawPage(note.id, note.category, raw);
					setDirty(false);
					setNotice("已保存");
					const data = await (await fetch(`/api/obsidian-wiki/page?id=${encodeURIComponent(note.id)}&category=${encodeURIComponent(note.category)}`)).json();
					if (!data.error) setContent(renderMarkdown(data.page?.body ?? ""));
					window.dispatchEvent(new CustomEvent("wiki:pages-changed"));
					onSaved?.();
				} catch (e) {
					setError(`保存失败：${e instanceof Error ? e.message : String(e)}`);
				} finally {
					setSaving(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-wb",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
						className: "knj-wb__title",
						children: note.title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "knj-wb__meta",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `knj-chip knj-chip--${note.category}`,
							children: note.category
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: note.id })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "knj-wb__actions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "knj-seg",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `knj-seg__item${mode === "preview" ? " knj-seg__item--active" : ""}`,
								onClick: () => setMode("preview"),
								children: "预览"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: `knj-seg__item${mode === "source" ? " knj-seg__item--active" : ""}`,
								onClick: () => setMode("source"),
								children: "源码"
							})]
						}), mode === "source" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "knj-btn",
							onClick: copy,
							children: [copied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconCheck, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconCopy, { size: 14 }), copied ? "已复制" : "复制"]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: `knj-btn ${dirty ? "knj-btn--primary" : "knj-btn--subtle"}`,
							disabled: !dirty || saving,
							onClick: save,
							children: saving ? "保存中…" : dirty ? "保存" : "已保存"
						})] })]
					}),
					brokenLink && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "knj-banner knj-banner--warn",
						style: { marginBottom: 10 },
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconWarning, { size: 14 }),
							"断链：页面「",
							brokenLink,
							"」不存在"
						]
					}),
					notice && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "knj-banner knj-banner--ok",
						style: { marginBottom: 10 },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconCheck, { size: 14 }), notice]
					}),
					error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "knj-banner knj-banner--err",
						style: { marginBottom: 10 },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconWarning, { size: 14 }), error]
					}),
					mode === "preview" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "wiki-md-content",
						onClick: onContentClick,
						dangerouslySetInnerHTML: { __html: content }
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
						className: "knj-wb__editor",
						value: raw,
						onChange: (e) => {
							setRaw(e.target.value);
							setDirty(true);
						},
						spellCheck: false,
						placeholder: "# 标题\n\n正文…（含 frontmatter 整份编辑）"
					}),
					mode === "source" && !dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "knj-banner knj-banner--info",
						style: { marginTop: 10 },
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconInfo, { size: 14 }), "源码态展示磁盘原文，可直接编辑并保存（id / category 与路径不符会被服务端拒绝）。"]
					})
				]
			});
		}
		//#endregion
		//#region src/client/NoteWorkbench.tsx
		/**
		* v5 笔记工作台（设计 v2）：历史栈导航 + wikilink 原地跳转 + 断链提示。
		* tab.path 种子（id|category）仍是入口；站内导航不再开新标签。
		*/
		function parseNotePath(path) {
			if (!path) return null;
			const idx = path.lastIndexOf("|");
			if (idx === -1) return null;
			return {
				id: path.slice(0, idx),
				category: path.slice(idx + 1)
			};
		}
		function NoteWorkbench({ path, onPagesChanged }) {
			const [index, setIndex] = (0, react.useState)(/* @__PURE__ */ new Map());
			const [stack, setStack] = (0, react.useState)([]);
			const [brokenLink, setBrokenLink] = (0, react.useState)(null);
			const seed = parseNotePath(path);
			(0, react.useEffect)(() => {
				let cancelled = false;
				fetchPages().then(({ pages }) => {
					if (cancelled) return;
					const m = /* @__PURE__ */ new Map();
					for (const p of pages) m.set(p.id, {
						category: p.category,
						title: p.title
					});
					setIndex(m);
				}).catch(() => {});
				return () => {
					cancelled = true;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (!seed) {
					setStack([]);
					setBrokenLink(null);
					return;
				}
				setStack([{
					id: seed.id,
					category: seed.category,
					title: seed.id
				}]);
				setBrokenLink(null);
			}, [seed?.id, seed?.category]);
			(0, react.useEffect)(() => {
				if (!stack.length) return;
				const top = stack[stack.length - 1];
				const meta = index.get(top.id);
				if (meta && meta.title !== top.title) setStack((s) => s.map((n, i) => i === s.length - 1 ? {
					...n,
					title: meta.title
				} : n));
			}, [index, stack]);
			const current = stack.length ? stack[stack.length - 1] : null;
			const navigate = (0, react.useCallback)((id) => {
				const meta = index.get(id);
				if (!meta) {
					setBrokenLink(id);
					return;
				}
				setBrokenLink(null);
				setStack((s) => [...s, {
					id,
					category: meta.category,
					title: meta.title
				}]);
			}, [index]);
			const back = (0, react.useCallback)(() => {
				setBrokenLink(null);
				setStack((s) => s.length > 1 ? s.slice(0, -1) : s);
			}, []);
			const handleSaved = (0, react.useCallback)(() => {
				fetchPages().then(({ pages }) => {
					const m = /* @__PURE__ */ new Map();
					for (const p of pages) m.set(p.id, {
						category: p.category,
						title: p.title
					});
					setIndex(m);
					setStack((s) => s.map((n) => {
						const meta = m.get(n.id);
						return meta ? {
							...n,
							title: meta.title
						} : n;
					}));
				}).catch(() => {});
				onPagesChanged?.();
			}, [onPagesChanged]);
			if (!current) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "knj-wiki",
				style: { height: "100%" },
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "knj-empty",
					style: { height: "100%" },
					children: "从知识库选择一篇笔记"
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "knj-wiki knj-wb-scroll",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					style: {
						padding: "14px 28px 0",
						maxWidth: 880,
						margin: "0 auto"
					},
					children: stack.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "knj-btn knj-btn--sm knj-wb__back",
						onClick: back,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconBack, { size: 13 }),
							"返回（",
							stack.length - 1,
							"）"
						]
					})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoteView, {
					note: current,
					brokenLink,
					onNavigate: navigate,
					onSaved: handleSaved
				})]
			});
		}
		//#endregion
		//#region src/client/styles.ts
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
		const WIKI_CSS = `
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

/* ============ 树（浏览视图） ============ */
.knj-wiki .knj-tree { display: flex; flex-direction: column; gap: 2px; padding: 4px; }
.knj-wiki .knj-tree__group { display: flex; flex-direction: column; }
.knj-wiki .knj-tree__head { display: flex; align-items: center; gap: 6px; padding: 8px 10px 4px; font-size: 12px; font-weight: 600; color: var(--knj-text-3); }
.knj-wiki .knj-tree__count { font-size: 11px; font-weight: 500; color: var(--knj-text-3); background: var(--knj-bg-1); border-radius: 999px; padding: 0 6px; line-height: 15px; }
.knj-wiki .knj-tree__item { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-radius: var(--knj-radius-s); color: var(--knj-text-2); cursor: pointer; font-size: 13px; line-height: 20px; transition: background .1s ease, color .1s ease; }
.knj-wiki .knj-tree__item:hover { background: var(--knj-hover); color: var(--knj-text); }
.knj-wiki .knj-tree__item-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.knj-wiki .knj-tree__item-icon { display: inline-flex; color: var(--knj-text-3); flex-shrink: 0; }
.knj-wiki .knj-tree__group-icon { display: inline-flex; color: var(--knj-text-3); flex-shrink: 0; }

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
`;
		/** 注入样式（幂等）：index.ts apply 时调用。 */
		function injectWikiStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById("dsh-knj-obsidian-styles")) return;
			const style = document.createElement("style");
			style.id = "dsh-knj-obsidian-styles";
			style.setAttribute("data-plugin", "dsh-knj-obsidian");
			style.textContent = WIKI_CSS;
			document.head.appendChild(style);
		}
		/** 移除注入样式（幂等）：插件卸载/HMR 时调用，避免旧版本样式常驻 DOM。 */
		function removeWikiStyles() {
			if (typeof document === "undefined") return;
			document.getElementById("dsh-knj-obsidian-styles")?.remove();
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* dsh-knj-obsidian client: registers the "知识库" sidebar tab and the
		* "笔记" workbench tab (A3 hybrid form) in the right sidebar (better-sidebar).
		* Built by tsdown into client/client.js.
		*/
		const name = "dsh-knj-obsidian";
		const inject = ["betterSidebar"];
		function apply(ctx) {
			ctx.effect(() => {
				injectWikiStyles();
				if (!ctx.betterSidebar) return;
				let workspaces;
				try {
					workspaces = ctx.workspaces;
				} catch {
					workspaces = void 0;
				}
				const disposers = [];
				/** 边栏点击笔记/图谱节点 → 主区域打开"笔记"工作台标签。 */
				const openNote = (id, category, title) => {
					ctx.betterSidebar?.openTab({
						type: "dsh-knj-obsidian:note",
						title,
						path: `${id}|${category}`
					});
				};
				disposers.push(ctx.betterSidebar.registerTab({
					id: "dsh-knj-obsidian",
					title: "知识库",
					component: () => (0, react.createElement)(WikiSidebar, {
						openNote,
						workspaces
					})
				}));
				disposers.push(ctx.betterSidebar.registerTab({
					id: "dsh-knj-obsidian:note",
					title: "笔记",
					component: (props) => (0, react.createElement)(NoteWorkbench, { path: props.tab?.path })
				}));
				return () => {
					for (const d of disposers) d();
					removeWikiStyles();
				};
			}, "dsh-knj-obsidian: sidebar tabs");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map