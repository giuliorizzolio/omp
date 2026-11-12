import { describe, expect, it } from "vitest";
import { buildSshArguments, buildSshSessionArguments, parseRemoteTargetInfo, resolveSshExecutable } from "./target.js";

const fileDoesNotExist = () => false;

describe("buildSshArguments", () => {
  it("builds argv without invoking a shell", () => {
    expect(
      buildSshArguments({
        host: "build-server",
        username: "deploy",
        port: 2222,
        identityFile: "/Users/dev/.ssh/work key",
      }),
    ).toEqual([
      "-o",
      "ConnectTimeout=30",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=4",
      "-p",
      "2222",
      "-i",
      "/Users/dev/.ssh/work key",
      "-tt",
      "deploy@build-server",
    ]);
  });

  it("builds a non-interactive multiplexed connection", () => {
    expect(
      buildSshArguments(
        { host: "build-server", username: "deploy" },
        { tty: false, controlPath: "/tmp/omp.sock", batchMode: true },
      ),
    ).toEqual([
      "-o",
      "ConnectTimeout=30",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=4",
      "-S",
      "/tmp/omp.sock",
      "-o",
      "BatchMode=yes",
      "-T",
      "deploy@build-server",
    ]);
  });

  it.each(["-oProxyCommand=evil", "host\ncommand", "host with-space"])(
    "rejects unsafe host %j",
    (host) => {
      expect(() => buildSshArguments({ host })).toThrow();
    },
  );
});

describe("buildSshSessionArguments", () => {
  const target = {
    host: "devbox",
    username: "dev",
    port: 22,
    identityFile: String.raw`C:\\Users\\developer\\.ssh\\id_ed25519`,
  };

  it("uses a standalone interactive SSH connection on Windows", () => {
    const args = buildSshSessionArguments(target, {
      platform: "win32",
      phase: "bootstrap",
      controlPath: "/tmp/ignored.sock",
    });

    expect(args).toContain("ControlMaster=no");
    expect(args).toContain("ControlPath=none");
    expect(args).toContain(target.identityFile);
    expect(args).toContain("-tt");
    expect(args).not.toContain("-M");
    expect(args).not.toContain("-S");
  });

  it("uses a separate noninteractive SSH connection for Windows commands and uploads", () => {
    const args = buildSshSessionArguments(target, {
      platform: "win32",
      phase: "command",
      controlPath: "/tmp/ignored.sock",
    });

    expect(args).toContain("ControlMaster=no");
    expect(args).toContain("ControlPath=none");
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("-T");
    expect(args).toContain(target.identityFile);
    expect(args).not.toContain("-M");
    expect(args).not.toContain("-S");
  });

  it.each(["linux", "darwin"] as const)("preserves multiplexing for %s", (platform) => {
    const bootstrap = buildSshSessionArguments(target, {
      platform,
      phase: "bootstrap",
      controlPath: "/tmp/omp.sock",
    });
    const command = buildSshSessionArguments(target, {
      platform,
      phase: "command",
      controlPath: "/tmp/omp.sock",
    });

    expect(bootstrap).toContain("-M");
    expect(bootstrap).toContain("-S");
    expect(bootstrap).toContain("ControlPersist=no");
    expect(command).not.toContain("-M");
    expect(command).toContain("-S");
    expect(command).toContain("BatchMode=yes");
    expect(command).toContain("-T");
  });

  it("requires a control path for POSIX SSH multiplexing", () => {
    expect(() => buildSshSessionArguments(target, {
      platform: "linux",
      phase: "bootstrap",
    })).toThrow("SSH control path is required");
  });
});

describe("resolveSshExecutable", () => {
  it("resolves ssh.exe before starting a Windows PTY with an identity file", () => {
    const executable = String.raw`C:\Windows\System32\OpenSSH\ssh.exe`;
    const identityFile = String.raw`D:\pem\aliyun\ckcc.pem`;

    expect(
      resolveSshExecutable("win32", { SystemRoot: String.raw`C:\Windows` }, (candidate) => {
        return candidate === executable;
      }),
    ).toBe(executable);
    expect(buildSshArguments({ host: "build-server", identityFile })).toContain(identityFile);
  });

  it("reports a missing Windows OpenSSH client directly", () => {
    expect(() => resolveSshExecutable("win32", {}, fileDoesNotExist)).toThrow(
      "Install the Windows OpenSSH Client feature",
    );
  });
});

describe("parseRemoteTargetInfo", () => {
  const home = Buffer.from("/home/deploy user").toString("base64");
  it.each([
    ["Darwin", "x86_64", "none", "darwin", "x64"],
    ["Darwin", "arm64", "none", "darwin", "arm64"],
    ["Linux", "x86_64", "glibc 2.35", "linux", "x64"],
    ["Linux", "aarch64", "glibc 2.35", "linux", "arm64"],
  ])("selects %s %s from SSH inspection rather than the client", (system, machine, libc, platform, arch) => {
    expect(parseRemoteTargetInfo(`${system}|${machine}|${home}|${libc}`)).toEqual({ platform, arch, home: "/home/deploy user" });
  });

  it.each(["musl 1.2.5", "unknown", ""])("rejects unsupported Linux libc %j explicitly", (libc) => {
    expect(() => parseRemoteTargetInfo(`Linux|x86_64|${home}|${libc}`)).toThrow("Linux remote hosts require glibc; musl is unsupported");
  });

  it.each(["Windows_NT|x86_64", "Linux|riscv64", "Darwin|unknown"])("rejects unsupported host %s", (target) => {
    expect(() => parseRemoteTargetInfo(`${target}|${home}|none`)).toThrow("Unsupported SSH host platform");
  });
});
