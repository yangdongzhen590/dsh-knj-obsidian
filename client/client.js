window.__ModuleLoader__.load({
	id: "dsh-knj-obsidian",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/WikiSidebar.tsx
		/**
		* 知识库边栏标签：vault 树 + 搜索 + lint 徽标（Task 3 完善）。
		* 当前为最小骨架，保证 client 构建通过。
		*/
		function WikiSidebar() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: 8,
					fontSize: 13,
					color: "#9ca3af"
				},
				children: "知识库（v4 开发中）"
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