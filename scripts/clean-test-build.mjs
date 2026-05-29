import { rmSync } from "node:fs";

rmSync(".ts-build", { recursive: true, force: true });