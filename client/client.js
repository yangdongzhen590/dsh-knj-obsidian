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
			const [loaded, setLoaded] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				fetchPages().then((r) => {
					setPages(r.pages);
					setLoaded(true);
				}).catch((e) => {
					setError(String(e));
					setLoaded(true);
				});
			}, []);
			if (error) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					color: "#f87171",
					fontSize: 12
				},
				children: ["加载失败：", error]
			});
			if (!loaded) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: 16,
					fontSize: 13,
					color: "#6b7280",
					textAlign: "center"
				},
				children: "加载中…"
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
				} catch {
					onResult([]);
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
		//#region src/client/GraphView.tsx
		/**
		* 图谱视图：拉取 /api/obsidian-wiki/graph，用力导向布局（斥力 + 弹簧力）渲染进 <svg>。
		* 节点按 category 着色，孤儿灰色，断链红色虚线；点击节点回调 onOpenNote 打开笔记。
		*
		* 安全：所有用户可控字段（节点 id/title/category）进入 innerHTML 前一律经 esc()
		* 转义（含属性值场景的引号）——含 <script> 的标题只会以实体形式出现，无脚本执行面。
		*/
		const CATEGORY_COLORS = {
			concepts: "#3b82f6",
			entities: "#22c55e",
			references: "#f97316",
			synthesis: "#a855f7",
			projects: "#6b7280"
		};
		const ESC_MAP = {
			"<": "&lt;",
			">": "&gt;",
			"&": "&amp;",
			"\"": "&quot;"
		};
		function esc(s) {
			return s.replace(/[<>&"]/g, (c) => ESC_MAP[c] ?? c);
		}
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
					for (const e of edges) out += `<line x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" stroke="${e.broken ? "#f87171" : "#4b5563"}" stroke-width="1.5"${e.broken ? " stroke-dasharray=\"4 3\"" : ""}/>`;
					for (const n of nodes) {
						const fill = orphans.has(n.id) ? "#374151" : CATEGORY_COLORS[n.category] ?? "#6b7280";
						out += `<g data-id="${esc(n.id)}" data-category="${esc(n.category)}" data-title="${esc(n.title)}" style="cursor:pointer">`;
						out += `<circle cx="${n.x}" cy="${n.y}" r="9" fill="${fill}"/>`;
						out += `<text x="${n.x + 12}" y="${n.y + 4}" font-size="10" fill="#e5e7eb">${esc(n.title)}</text>`;
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
				style: {
					padding: 16,
					color: "#f87171"
				},
				children: ["图谱加载失败：", error]
			});
			if (!graph) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: 16,
					color: "#9ca3af"
				},
				children: "图谱加载中…"
			});
			if (graph.nodes.length < 2) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: 24,
					color: "#9ca3af",
					textAlign: "center"
				},
				children: [
					"图谱过小（",
					graph.nodes.length,
					" 节点）——先吸收几份文档，图谱就会长出来。"
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: { padding: 12 },
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						fontSize: 12,
						color: "#9ca3af",
						marginBottom: 8
					},
					children: [
						graph.nodes.length,
						" 节点 · ",
						graph.edges.length,
						" 边 · 点击节点打开笔记"
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
					ref: svgRef,
					width: 600,
					height: 400,
					viewBox: "0 0 600 400",
					style: {
						background: "#111827",
						borderRadius: 8,
						width: "100%",
						height: "auto"
					}
				})]
			});
		}
		//#endregion
		//#region src/client/WikiSidebar.tsx
		/**
		* 知识库边栏标签（A3 混合形态入口）：顶部搜索 + lint 徽标，浏览/图谱切换。
		* 浏览 = 按 category 分组的 vault 树（或搜索结果，可返回）；图谱 = 交互图谱。
		* 点击笔记/图谱节点 → openNote（由 index.ts 注入 openTab 到主区域工作台标签）。
		*/
		function WikiSidebar({ openNote }) {
			const [results, setResults] = (0, react.useState)(null);
			const [view, setView] = (0, react.useState)("browse");
			const tabStyle = (active) => ({
				padding: "6px 12px",
				cursor: "pointer",
				fontSize: 13,
				color: active ? "#3b82f6" : "#9ca3af",
				borderBottom: active ? "2px solid #3b82f6" : "none"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					flexDirection: "column",
					height: "100%"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchBox, { onResult: setResults }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LintBadge, {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							borderBottom: "1px solid #1f2937"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							onClick: () => setView("browse"),
							style: tabStyle(view === "browse"),
							children: "浏览"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							onClick: () => setView("graph"),
							style: tabStyle(view === "graph"),
							children: "图谱"
						})]
					}),
					view === "graph" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							overflow: "auto"
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GraphView, { onOpenNote: openNote })
					}) : results !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							flex: 1,
							overflow: "auto"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									justifyContent: "space-between",
									padding: "4px 8px",
									alignItems: "center"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontWeight: 600,
										color: "#d1d5db",
										fontSize: 12
									},
									children: [
										"搜索结果（",
										results.length,
										"）"
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									onClick: () => setResults(null),
									style: {
										background: "transparent",
										border: "none",
										color: "#3b82f6",
										cursor: "pointer",
										fontSize: 12
									},
									children: "← 返回"
								})]
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
								onClick: () => openNote(c.id, c.category, c.title),
								style: {
									padding: "6px 8px",
									borderBottom: "1px solid #1f2937",
									cursor: "pointer"
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
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VaultTree, { onOpen: (p) => openNote(p.id, p.category, p.title) })
					})
				]
			});
		}
		//#endregion
		//#region src/client/markdown.ts
		/**
		* 极简 markdown → 安全 HTML 渲染：
		* - 先 HTML 转义（防注入）
		* - 再把 [[wikilink]] 转成可点击链接
		* 支持：标题（# 前缀）、粗体、代码块（``` 围栏）、行内代码、列表（- 前缀）、wikilink。
		* 不支持完整 markdown（v4 只读渲染，够用即可）。
		*
		* 安全模式「先转义后白名单」：escapeHtml 在一切规则之前对全文执行；
		* 此后仅追加白名单标签（h1-h4/ul/li/p/div/pre/code/strong/a），
		* 锚点 href 固定为 '#'，无 javascript: 注入面。
		*/
		function escapeHtml(s) {
			return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
		}
		const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
		/** wikilink 目标 → 页面标识（category/id 需由调用方解析；此处转成 data 属性 + 文本） */
		function renderWikilinks(text) {
			return text.replace(WIKILINK_RE, (_m, target) => {
				const id = target.trim();
				return `<a href="#" data-wikilink="${escapeHtml(id)}" style="color:#3b82f6;text-decoration:underline">${escapeHtml(id)}</a>`;
			});
		}
		function renderMarkdown(text) {
			const escaped = escapeHtml(text);
			const blocks = [];
			const lines = escaped.replace(/```([\s\S]*?)```/g, (_m, code) => {
				blocks.push(`<pre style="background:#111827;padding:8px;border-radius:6px;overflow:auto"><code>${code}</code></pre>`);
				return `\u0000BLOCK${blocks.length - 1}\u0000`;
			}).split("\n");
			const out = [];
			let inList = false;
			for (const raw of lines) {
				const line = raw.trimEnd();
				const m = line.match(/^(#{1,4})\s+(.*)$/);
				if (m) {
					if (inList) {
						out.push("</ul>");
						inList = false;
					}
					const h = [
						"h1",
						"h2",
						"h3",
						"h4"
					][Math.min(m[1].length, 4) - 1] ?? "h4";
					out.push(`<${h} style="margin:8px 0;color:#f3f4f6">${renderWikilinks(m[2] ?? "")}</${h}>`);
					continue;
				}
				if (line.startsWith("- ")) {
					if (!inList) {
						out.push("<ul style=\"margin:4px 0;padding-left:20px\">");
						inList = true;
					}
					out.push(`<li>${renderWikilinks(line.slice(2))}</li>`);
					continue;
				}
				if (inList) {
					out.push("</ul>");
					inList = false;
				}
				if (line === "") {
					out.push("<div style=\"height:6px\"></div>");
					continue;
				}
				const block = line.match(/^\u0000BLOCK(\d+)\u0000$/);
				if (block) {
					out.push(blocks[Number(block[1])]);
					continue;
				}
				const inline = line.replace(/`([^`]+)`/g, (_mm, code) => `<code style="background:#1f2937;padding:1px 4px;border-radius:3px;font-size:12px">${code}</code>`).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
				out.push(`<p style="margin:4px 0;color:#d1d5db;line-height:1.6">${renderWikilinks(inline)}</p>`);
			}
			if (inList) out.push("</ul>");
			return out.join("\n");
		}
		//#endregion
		//#region src/client/NoteWorkbench.tsx
		function parseNotePath(path) {
			if (!path) return null;
			const idx = path.lastIndexOf("|");
			if (idx === -1) return null;
			return {
				id: path.slice(0, idx),
				category: path.slice(idx + 1)
			};
		}
		function NoteWorkbench({ path }) {
			const [content, setContent] = (0, react.useState)("");
			const [title, setTitle] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)(null);
			const ref = parseNotePath(path);
			(0, react.useEffect)(() => {
				let cancelled = false;
				if (!ref) {
					setContent("");
					setTitle("");
					return;
				}
				setError(null);
				fetch(`/api/obsidian-wiki/page?id=${encodeURIComponent(ref.id)}&category=${encodeURIComponent(ref.category)}`).then((r) => r.json()).then((data) => {
					if (cancelled) return;
					if (data.error) setError(data.error);
					else {
						setTitle(data.page?.title ?? ref.id);
						setContent(renderMarkdown(data.page?.body ?? ""));
					}
				}).catch((e) => {
					if (!cancelled) setError(String(e));
				});
				return () => {
					cancelled = true;
				};
			}, [path]);
			if (!ref) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: 24,
					color: "#9ca3af",
					textAlign: "center"
				},
				children: "从知识库选择一篇笔记"
			});
			if (error) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: 16,
					color: "#f87171"
				},
				children: ["加载失败：", error]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "16px 24px",
					maxWidth: 860,
					margin: "0 auto"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
						style: {
							margin: "0 0 8px",
							fontSize: 24,
							color: "#f3f4f6"
						},
						children: title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							marginBottom: 16,
							padding: "8px 12px",
							background: "#1f2937",
							borderRadius: 6,
							fontSize: 12,
							color: "#9ca3af"
						},
						children: [
							ref.category,
							" · ",
							ref.id
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { dangerouslySetInnerHTML: { __html: content } })
				]
			});
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
				if (!ctx.betterSidebar) return;
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
					component: () => (0, react.createElement)(WikiSidebar, { openNote })
				}));
				disposers.push(ctx.betterSidebar.registerTab({
					id: "dsh-knj-obsidian:note",
					title: "笔记",
					component: (props) => (0, react.createElement)(NoteWorkbench, { path: props.tab?.path })
				}));
				return () => {
					for (const d of disposers) d();
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