import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { access, readFile } from "fs/promises";
import { constants } from "fs";
import { createRequire } from "module";
import { dirname, extname, join, resolve } from "path";
import { fileURLToPath } from "url";

const banner =
  "/* Voxora: desktop-only Obsidian plugin for meeting recording. */";
const prod = process.argv[2] === "production";
const workingDir = dirname(fileURLToPath(import.meta.url));
const entryPoint = join(workingDir, "src/main.ts");
const entryContents = await readFile(entryPoint, "utf8");
const require = createRequire(import.meta.url);

async function findImportPath(importPath, resolveDir) {
  const basePath = resolve(resolveDir, importPath);
  const candidates = extname(basePath)
    ? [basePath]
    : [
        basePath,
        `${basePath}.ts`,
        `${basePath}.js`,
        join(basePath, "index.ts"),
        join(basePath, "index.js")
      ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      // Try the next extension.
    }
  }

  return undefined;
}

const workspaceResolver = {
  name: "workspace-resolver",
  setup(build) {
    build.onResolve({ filter: /^\./ }, async (args) => {
      const resolved = await findImportPath(
        args.path,
        args.resolveDir || join(workingDir, "src")
      );

      if (!resolved) {
        return;
      }

      return { path: resolved };
    });

    build.onResolve({ filter: /^(uuid|ws|yaml)$/ }, (args) => ({
      path: require.resolve(args.path)
    }));
  }
};

const context = await esbuild.context({
  banner: { js: banner },
  absWorkingDir: workingDir,
  stdin: {
    contents: entryContents,
    sourcefile: "main.ts",
    resolveDir: join(workingDir, "src"),
    loader: "ts"
  },
  bundle: true,
  plugins: [workspaceResolver],
  platform: "node",
  external: [
    "node:*",
    "obsidian",
    "electron",
    "bufferutil",
    "utf-8-validate",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: join(workingDir, "main.js")
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
