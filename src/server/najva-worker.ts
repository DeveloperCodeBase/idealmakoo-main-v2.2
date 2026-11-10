/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { isAbsolute, basename } from "node:path";
import { statSync, readFileSync } from "node:fs";
import { Script } from "node:vm";
function configuredNajvaWorker() {
    const file = process.env.NAJVA_WORKER_FILE;
    if (!file || !(isAbsolute)(file) || (basename)(file) !== "najva-messaging-sw.js")
        return null;
    try {
        const stat = (statSync)(file);
        if (!stat.isFile() || stat.size < 20 || stat.size > 262144)
            return null;
        const source = (readFileSync)(file, "utf8");
        if (!/najva/i.test(source) || !/(?:importScripts\s*\(|addEventListener\s*\()/.test(source) || /<\/?(?:script|html|body)\b/i.test(source))
            return null;
        new Script(source, { filename: "najva-messaging-sw.js" });
        return source;
    }
    catch {
        return null;
    }
}
export { configuredNajvaWorker };
