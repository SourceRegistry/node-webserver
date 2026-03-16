import {WebServer} from "../src";

const server = new WebServer();

server.router.pre(({request}) => console.log(`[${request.method}] ${request.url}`));

server.router.GET('/', () => new Response('Hello world!'))

server.listen(3000, () => {
    console.log("Server listening on port 3000");
})
