## [1.6.6](https://github.com/SourceRegistry/node-webserver/compare/v1.6.5...v1.6.6) (2026-04-07)


### Bug Fixes

* **docs:** fix badge ([40a2b0e](https://github.com/SourceRegistry/node-webserver/commit/40a2b0ee431cf3c2f642c6609e5f0dbd5cb041ef))

## [1.6.5](https://github.com/SourceRegistry/node-webserver/compare/v1.6.4...v1.6.5) (2026-04-07)


### Bug Fixes

* **jsr:** generate isolated declaration graph ([6c3cf40](https://github.com/SourceRegistry/node-webserver/commit/6c3cf402ab2df5e4aab988b7d4b520f48a8947c8))
* **jsr:** trigger isolated declaration publish ([854845c](https://github.com/SourceRegistry/node-webserver/commit/854845c527896789e90ddefea21defe20839f2ba))

## [1.6.4](https://github.com/SourceRegistry/node-webserver/compare/v1.6.3...v1.6.4) (2026-04-07)


### Bug Fixes

* **jsr:** publish compiled entrypoint ([12602b2](https://github.com/SourceRegistry/node-webserver/commit/12602b25c1fc614fc4c6ad68a05be7c797f9ea80))
* **jsr:** publish declaration wrapper ([8f62f74](https://github.com/SourceRegistry/node-webserver/commit/8f62f745781b4b03ed01add1269696490d0444c1))

## [1.6.3](https://github.com/SourceRegistry/node-webserver/compare/v1.6.2...v1.6.3) (2026-04-07)


### Bug Fixes

* **release:** allow dirty jsr publish ([9250a63](https://github.com/SourceRegistry/node-webserver/commit/9250a63642a50cf624817dfb3a8d310ae38f3998))

## [1.6.2](https://github.com/SourceRegistry/node-webserver/compare/v1.6.1...v1.6.2) (2026-04-07)


### Bug Fixes

* **release:** fix alignment with ci ([d01fc92](https://github.com/SourceRegistry/node-webserver/commit/d01fc926a28010ec9d520ac9268926747eac8efe))
* **release:** publish jsr with global app typings ([22e6518](https://github.com/SourceRegistry/node-webserver/commit/22e65180930dae84683d2e23992c5e64359cba75))

## [1.6.1](https://github.com/SourceRegistry/node-webserver/compare/v1.6.0...v1.6.1) (2026-04-07)


### Bug Fixes

* **release:** unify ci and jsr publishing ([4dae7c5](https://github.com/SourceRegistry/node-webserver/commit/4dae7c5b7d5256ea9fa50aa70cccb2f1d4fa15c4))

# [1.6.0](https://github.com/SourceRegistry/node-webserver/compare/v1.5.0...v1.6.0) (2026-04-01)


### Features

* **ratelimiter:** add slidingWindowLimit and enhance onRateLimit callback ([0878145](https://github.com/SourceRegistry/node-webserver/commit/0878145fa64149039101f2a604da12db0ab5c657))

# [1.5.0](https://github.com/SourceRegistry/node-webserver/compare/v1.4.0...v1.5.0) (2026-04-01)


### Bug Fixes

* **security:** address identified vulnerabilities ([ba72977](https://github.com/SourceRegistry/node-webserver/commit/ba729777544072fb4056aff5d69a32b77b1f014e))


### Features

* add client request ID validation option ([b2b4a10](https://github.com/SourceRegistry/node-webserver/commit/b2b4a10155fe462f1b719ad614437846f8ade9e1))

# [1.4.0](https://github.com/SourceRegistry/node-webserver/compare/v1.3.1...v1.4.0) (2026-03-20)


### Bug Fixes

* **tests:** fix naming of server test ([fa5eaf6](https://github.com/SourceRegistry/node-webserver/commit/fa5eaf694bf55bd65d8fdd22b7968679a5604477))


### Features

* harden server runtime and add production middleware ([b198d9b](https://github.com/SourceRegistry/node-webserver/commit/b198d9b6ce21fc61e1a5aa9bcc1c5bd9549e3135))

## [1.3.1](https://github.com/SourceRegistry/node-webserver/compare/v1.3.0...v1.3.1) (2026-03-20)


### Bug Fixes

* harden streaming abort and sse cleanup ([46048d9](https://github.com/SourceRegistry/node-webserver/commit/46048d9876548781e255987025ab4e28ba869c4b))
* **package.json:** updated packages ([ed35f7a](https://github.com/SourceRegistry/node-webserver/commit/ed35f7a021c224314c7746fd1808e0ec69509d06))

# [1.3.0](https://github.com/SourceRegistry/node-webserver/compare/v1.2.3...v1.3.0) (2026-03-17)


### Features

* add route enhancers and server-aware event fetch ([4bbb80c](https://github.com/SourceRegistry/node-webserver/commit/4bbb80ccac62895913f5a7ee3df753cd7d0284db))

## [1.2.3](https://github.com/SourceRegistry/node-webserver/compare/v1.2.2...v1.2.3) (2026-03-16)


### Bug Fixes

* **router:** Made router use App.Locals ([dce68d4](https://github.com/SourceRegistry/node-webserver/commit/dce68d46b3b954d277a9dc2598b9315a4fb1b0da))

## [1.2.2](https://github.com/SourceRegistry/node-webserver/compare/v1.2.1...v1.2.2) (2026-03-16)


### Bug Fixes

* **sse:** added server send events response helper ([4481d33](https://github.com/SourceRegistry/node-webserver/commit/4481d33dc80a8054d29287800460cba94d30617b))

## [1.2.1](https://github.com/SourceRegistry/node-webserver/compare/v1.2.0...v1.2.1) (2026-03-16)


### Bug Fixes

* **docs:** redirect/error in README ([1728439](https://github.com/SourceRegistry/node-webserver/commit/172843918319224d0c9d1a6021f7acf412cfd5f4))

# [1.2.0](https://github.com/SourceRegistry/node-webserver/compare/v1.1.0...v1.2.0) (2026-03-16)


### Features

* **redirect/error:** more direct error path in routes and cleaner return ([9064120](https://github.com/SourceRegistry/node-webserver/commit/90641209b07f580b45bef06c4cb1c76530f6b8ad))

# [1.1.0](https://github.com/SourceRegistry/node-webserver/compare/v1.0.0...v1.1.0) (2026-03-16)


### Features

* **webserver:** webserver now extends router for more ergonomic api ([33df4a1](https://github.com/SourceRegistry/node-webserver/commit/33df4a11bb4720c6aa66a694a6c62d08b8e7995d))

# 1.0.0 (2026-03-16)


### Bug Fixes

* **release:** initial commit to push files ([e27b243](https://github.com/SourceRegistry/node-webserver/commit/e27b2435e3db8362b5cf95cbba3697088cd75c51))
* **release:** initial commit to push files ([1ff84e7](https://github.com/SourceRegistry/node-webserver/commit/1ff84e7eaeff17cdb8b1c785fcca953aa4018345))
