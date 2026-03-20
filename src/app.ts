declare global {
    namespace App {
        interface Locals {
        }

        interface Platform {
            readonly dev: boolean
        }

        interface Error {
            message?: string
        }
    }
}

export {};
