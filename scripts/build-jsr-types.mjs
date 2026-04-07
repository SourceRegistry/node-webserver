import {mkdir, readdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import path from "node:path";

const distRoot = path.resolve("dist");
const outRoot = path.resolve("generated", "jsr-types");

async function walk(dir) {
    const entries = await readdir(dir, {withFileTypes: true});
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await walk(fullPath));
        } else if (entry.isFile() && entry.name.endsWith(".d.ts")) {
            files.push(fullPath);
        }
    }

    return files;
}

function replaceAppReferences(source, relativeAppPath) {
    const specifier = relativeAppPath.replace(/\\/g, "/");

    return source
        .replaceAll("App.Locals", `import("${specifier}").AppLocals`)
        .replaceAll("App.Platform", `import("${specifier}").AppPlatform`)
        .replaceAll("App.Error", `import("${specifier}").AppError`);
}

async function main() {
    try {
        const distStat = await stat(distRoot);
        if (!distStat.isDirectory()) {
            throw new Error("dist is not a directory");
        }
    } catch {
        throw new Error("Build output is missing. Run `npm run build` first.");
    }

    await rm(outRoot, {recursive: true, force: true});
    await mkdir(outRoot, {recursive: true});

    await writeFile(path.join(outRoot, "app.d.ts"), [
        "export interface AppLocals {}",
        "export interface AppPlatform {",
        "  readonly dev: boolean;",
        "}",
        "export interface AppError {",
        "  message?: string;",
        "}",
        "",
    ].join("\n"));

    const files = await walk(distRoot);
    for (const file of files) {
        const relativePath = path.relative(distRoot, file);
        if (relativePath === "app.d.ts") {
            continue;
        }

        const outPath = path.join(outRoot, relativePath);
        await mkdir(path.dirname(outPath), {recursive: true});

        const source = await readFile(file, "utf8");
        const relativeAppPath = path.relative(path.dirname(outPath), path.join(outRoot, "app")).replace(/\\/g, "/");
        const rewritten = replaceAppReferences(source, relativeAppPath.startsWith(".") ? relativeAppPath : `./${relativeAppPath}`);
        await writeFile(outPath, rewritten);
    }
}

await main();
