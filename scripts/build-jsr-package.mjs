import {cp, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const distRoot = path.resolve(rootDir, "dist");
const jsrTypesRoot = path.resolve(rootDir, "generated", "jsr-types");
const outRoot = path.resolve(rootDir, "generated", "jsr-publish");
const outDistRoot = path.join(outRoot, "dist");

async function assertDirectory(dir, message) {
    try {
        const value = await stat(dir);
        if (!value.isDirectory()) {
            throw new Error(message);
        }
    } catch {
        throw new Error(message);
    }
}

async function main() {
    await assertDirectory(distRoot, "Build output is missing. Run `npm run build` first.");
    await assertDirectory(jsrTypesRoot, "JSR types are missing. Run `npm run build:jsr-types` first.");

    const pkg = JSON.parse(await readFile(path.resolve(rootDir, "package.json"), "utf8"));
    const imports = Object.fromEntries(
        Object.entries(pkg.dependencies ?? {}).map(([name, version]) => [name, `npm:${name}@${version}`]),
    );

    await rm(outRoot, {recursive: true, force: true});
    await mkdir(outRoot, {recursive: true});

    await cp(distRoot, outDistRoot, {
        recursive: true,
        filter(source) {
            return !source.endsWith(".d.ts");
        },
    });
    await cp(jsrTypesRoot, outDistRoot, {recursive: true});
    await cp(path.resolve(rootDir, "README.md"), path.join(outRoot, "README.md"));
    await cp(path.resolve(rootDir, "LICENSE"), path.join(outRoot, "LICENSE"));

    await writeFile(path.join(outRoot, "index.js"), [
        "/* @ts-self-types=\"./index.d.ts\" */",
        "",
        "export * from \"./dist/index.es.js\";",
        "",
    ].join("\n"));

    await writeFile(path.join(outRoot, "index.d.ts"), "export * from \"./dist/index\";\n");

    const jsrConfig = {
        $schema: "https://jsr.io/schema/config-file.v1.json",
        name: pkg.name,
        version: pkg.version,
        imports,
        exports: {
            ".": "./index.js",
        },
        publish: {
            include: [
                "index.js",
                "index.d.ts",
                "dist/**/*.js",
                "dist/**/*.d.ts",
                "README.md",
                "LICENSE",
            ],
            exclude: [
                "!**",
            ],
        },
    };

    await writeFile(path.join(outRoot, "jsr.json"), `${JSON.stringify(jsrConfig, null, 2)}\n`);
}

await main();
