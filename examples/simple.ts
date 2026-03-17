import {WebServer, text} from "../src";

const server = new WebServer();

server.pre(({request}) => console.log(`[${request.method}] ${request.url}`));

server.GET('/', () => text('Hello world!'))

server.listen(3000, () => {
    console.log("Server listening on port 3000");
})
