import test from "node:test";
import assert from "node:assert/strict";

import { registerMemoryCli } from "../../src/cli.js";
import { registerMemoryCliMetadata } from "../../src/cli-descriptors.js";
import type { PluginRuntime } from "../../src/plugin-runtime.js";

type RegisteredCli = {
  builder: (ctx: { program: FakeCommand }) => void;
  opts?: {
    descriptors?: Array<{
      name: string;
      description: string;
      hasSubcommands: boolean;
    }>;
  };
};

class FakeCommand {
  public commands: FakeCommand[] = [];
  public descriptions: string[] = [];
  public options: string[] = [];
  public arguments: string[] = [];
  public handler: ((...args: unknown[]) => unknown) | null = null;

  constructor(private readonly commandName: string) {}

  command(name: string): FakeCommand {
    const child = new FakeCommand(name);
    this.commands.push(child);
    return child;
  }

  description(text: string): FakeCommand {
    this.descriptions.push(text);
    return this;
  }

  argument(name: string): FakeCommand {
    this.arguments.push(name);
    return this;
  }

  option(flags: string): FakeCommand {
    this.options.push(flags);
    return this;
  }

  requiredOption(flags: string): FakeCommand {
    this.options.push(flags);
    return this;
  }

  action(handler: (...args: unknown[]) => unknown): FakeCommand {
    this.handler = handler;
    return this;
  }

  name(): string {
    return this.commandName;
  }
}

const selectedConfig = {
  plugins: {
    slots: {
      memory: "libravdb-memory",
      contextEngine: "libravdb-memory",
    },
  },
};

function createRuntime(): PluginRuntime {
  return {
    async getRpc() {
      throw new Error("not used by registration tests");
    },
    getKernel() {
      return null;
    },
    async emitLifecycleHint() {},
    async shutdown() {},
  };
}

test("CLI metadata registers the memory descriptor only when LibraVDB owns the memory slot", () => {
  const registered: RegisteredCli[] = [];
  const api = {
    config: selectedConfig,
    registerCli(builder: unknown, opts: RegisteredCli["opts"]) {
      registered.push({ builder: builder as RegisteredCli["builder"], opts });
    },
  };

  registerMemoryCliMetadata(api);

  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0]?.opts?.descriptors, [
    {
      name: "memory",
      description: "Manage LibraVDB memory",
      hasSubcommands: true,
    },
  ]);

  const skipped: RegisteredCli[] = [];
  registerMemoryCliMetadata({
    config: { plugins: { slots: { memory: "memory-core" } } },
    registerCli(builder: unknown, opts: RegisteredCli["opts"]) {
      skipped.push({ builder: builder as RegisteredCli["builder"], opts });
    },
  });
  assert.equal(skipped.length, 0);
});

test("full CLI registration exposes standard memory commands and LibraVDB operator commands", () => {
  let registered: RegisteredCli | null = null;
  const api = {
    config: selectedConfig,
    registerCli(builder: unknown, opts: RegisteredCli["opts"]) {
      registered = { builder: builder as RegisteredCli["builder"], opts };
    },
  };

  registerMemoryCli(api as never, createRuntime(), {});

  assert.ok(registered);
  const cli = registered as RegisteredCli;
  const program = new FakeCommand("openclaw");
  cli.builder({ program });

  const memory = program.commands.find((command) => command.name() === "memory");
  assert.ok(memory);
  assert.deepEqual(
    memory.commands.map((command) => command.name()),
    ["status", "index", "search", "flush", "export", "journal", "dream-promote"],
  );

  const status = memory.commands.find((command) => command.name() === "status");
  assert.ok(status);
  assert.ok(status.options.includes("--json"));
  assert.ok(status.options.includes("--agent <id>"));

  const search = memory.commands.find((command) => command.name() === "search");
  assert.ok(search);
  assert.ok(search.arguments.includes("[query]"));
  assert.ok(search.options.includes("--query <text>"));
  assert.ok(search.options.includes("--max-results <n>"));
  assert.ok(search.options.includes("--json"));
});

test("non-full CLI registration exposes command structure without action handlers", () => {
  let registered: RegisteredCli | null = null;
  const api = {
    config: selectedConfig,
    registerCli(builder: unknown, opts: RegisteredCli["opts"]) {
      registered = { builder: builder as RegisteredCli["builder"], opts };
    },
  };

  registerMemoryCli(api as never, null, {});

  assert.ok(registered);
  const cli = registered as RegisteredCli;
  const program = new FakeCommand("openclaw");
  cli.builder({ program });

  const memory = program.commands.find((command) => command.name() === "memory");
  assert.ok(memory);
  assert.deepEqual(
    memory.commands.map((command) => command.name()),
    ["status", "index", "search", "flush", "export", "journal", "dream-promote"],
  );
  assert.ok(memory.commands.every((command) => command.handler === null));
});
