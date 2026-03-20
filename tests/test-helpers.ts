import {afterEach} from "vitest";

import {WebServer} from "../src";

export function useServerLifecycle() {
    const servers: WebServer[] = [];

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
            server.close((err) => err ? reject(err) : resolve());
        })));
    });

    return {
        async startServer(server: WebServer): Promise<number> {
            servers.push(server);
            await new Promise<void>((resolve) => {
                server.listen(0, "127.0.0.1", resolve);
            });
            const address = server.address();
            if (!address || typeof address === "string") {
                throw new Error("Expected TCP server address");
            }

            return address.port;
        }
    };
}
