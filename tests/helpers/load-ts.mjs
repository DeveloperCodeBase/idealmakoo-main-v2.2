import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceRoot = resolve(projectRoot, "src") + sep;

function sourceFile(candidate) {
  for (const file of [candidate, `${candidate}.ts`, `${candidate}.mts`, resolve(candidate, "index.ts")]) {
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return candidate;
}

// Node 24 strips TypeScript itself. This hook only supplies the project's alias
// and extensionless source resolution; it does not replace application logic.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(pathToFileURL(sourceFile(resolve(sourceRoot, specifier.slice(2)))).href, context);
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const parent = fileURLToPath(context.parentURL);
      if (parent.startsWith(sourceRoot)) {
        return nextResolve(pathToFileURL(sourceFile(resolve(dirname(parent), specifier))).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

/** Import the actual TypeScript module using a path relative to the repository root. */
export async function loadTs(relativePath) {
  const file = isAbsolute(relativePath) ? relativePath : resolve(projectRoot, relativePath);
  return import(pathToFileURL(sourceFile(file)).href);
}
