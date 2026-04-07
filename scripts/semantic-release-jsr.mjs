import {readFile, writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import path from "node:path";

const configPath = path.resolve("jsr.json");

function run(command, args, context) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: context.cwd,
            env: context.env,
            stdio: ["ignore", "pipe", "pipe"],
            shell: process.platform === "win32",
        });

        child.stdout?.pipe(context.stdout, {end: false});
        child.stderr?.pipe(context.stderr, {end: false});

        child.on("error", (error) => reject(error));
        child.on("close", (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(signal
                ? `Command failed with signal ${signal}: ${command} ${args.join(" ")}`
                : `Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
        });
    });
}

export async function verifyConditions(_pluginConfig, context) {
    const source = await readFile(configPath, "utf8");
    const config = JSON.parse(source);

    if (typeof config.name !== "string" || config.name.trim().length === 0) {
        throw new Error("jsr.json must contain a package name.");
    }

    await run("jsr", ["publish", "--dry-run", "--allow-slow-types", "--allow-dirty"], context);
}

export async function prepare(_pluginConfig, {nextRelease, logger}) {
    const source = await readFile(configPath, "utf8");
    const config = JSON.parse(source);

    config.version = nextRelease.version;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    logger.log("Wrote version %s to jsr.json", nextRelease.version);
}

export async function publish(_pluginConfig, context) {
    await run("jsr", ["publish", "--allow-slow-types", "--allow-dirty"], context);

    const source = await readFile(configPath, "utf8");
    const config = JSON.parse(source);
    return {
        name: "JSR",
        url: `https://jsr.io/${config.name}`,
    };
}
