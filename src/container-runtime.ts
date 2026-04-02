/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';

import { logger } from './logger.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'container';

/** Hostname containers use to reach the host machine. */
export const CONTAINER_HOST_GATEWAY = 'host.docker.internal';

/**
 * Apple Container(macOS) 가상 네트워크에서 호스트 IP.
 * macOS Virtualization framework가 192.168.64.0/24 서브넷을 고정으로 사용하며
 * 호스트는 항상 .1 주소입니다.
 */
export const APPLE_CONTAINER_HOST_IP = '192.168.64.1';

/**
 * Address the credential proxy binds to.
 * Apple Container (macOS): 192.168.64.1 — the VM host interface.
 *   Docker Desktop과 달리 Apple Container는 host.docker.internal을 loopback으로
 *   라우팅하지 않으므로, 프록시는 가상 네트워크 인터페이스에서 수신해야 합니다.
 * Docker (Linux): bind to the docker0 bridge IP so only containers can reach it,
 *   falling back to 0.0.0.0 if the interface isn't found.
 */
export const PROXY_BIND_HOST =
  process.env.CREDENTIAL_PROXY_HOST || detectProxyBindHost();

function detectProxyBindHost(): string {
  if (os.platform() === 'darwin') {
    // Apple Container의 가상 네트워크 인터페이스(192.168.64.1)는 container system
    // 시작 후에만 생성됩니다. NanoClaw가 먼저 시작될 수 있으므로 0.0.0.0에
    // 바인딩하여 항상 기동 가능하게 합니다. 컨테이너에서는 192.168.64.1로 접속합니다.
    return '0.0.0.0';
  }

  // WSL uses Docker Desktop (same VM routing as macOS) — loopback is correct.
  // Check /proc filesystem, not env vars — WSL_DISTRO_NAME isn't set under systemd.
  if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) return '127.0.0.1';

  // Bare-metal Linux: bind to the docker0 bridge IP instead of 0.0.0.0
  const ifaces = os.networkInterfaces();
  const docker0 = ifaces['docker0'];
  if (docker0) {
    const ipv4 = docker0.find((a) => a.family === 'IPv4');
    if (ipv4) return ipv4.address;
  }
  return '0.0.0.0';
}

/** CLI args needed for the container to resolve the host gateway. */
export function hostGatewayArgs(): string[] {
  // On Linux, host.docker.internal isn't built-in — add it explicitly
  if (os.platform() === 'linux') {
    return ['--add-host=host.docker.internal:host-gateway'];
  }
  return [];
}

/**
 * container args에서 host.docker.internal을 실제 호스트 IP로 교체합니다.
 * Apple Container는 --add-host를 지원하지 않으며 host.docker.internal을 자동으로
 * 등록하지 않으므로, OneCLI가 설정한 ANTHROPIC_BASE_URL 등의 값을 직접 교체합니다.
 * @param args - container run에 전달할 args 배열 (in-place 수정)
 */
export function resolveHostGateway(args: string[]): void {
  if (os.platform() !== 'darwin') return;
  for (let i = 0; i < args.length; i++) {
    if (args[i].includes(CONTAINER_HOST_GATEWAY)) {
      args[i] = args[i].replaceAll(CONTAINER_HOST_GATEWAY, APPLE_CONTAINER_HOST_IP);
    }
  }
}

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return [
    '--mount',
    `type=bind,source=${hostPath},target=${containerPath},readonly`,
  ];
}

/** Stop a container by name. Uses execFileSync to avoid shell injection. */
export function stopContainer(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new Error(`Invalid container name: ${name}`);
  }
  execSync(`${CONTAINER_RUNTIME_BIN} stop -t 1 ${name}`, { stdio: 'pipe' });
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execSync(`${CONTAINER_RUNTIME_BIN} system status`, { stdio: 'pipe' });
    logger.debug('Container runtime already running');
  } catch {
    logger.info('Starting container runtime...');
    try {
      execSync(`${CONTAINER_RUNTIME_BIN} system start`, {
        stdio: 'pipe',
        timeout: 30000,
      });
      logger.info('Container runtime started');
    } catch (err) {
      logger.error({ err }, 'Failed to start container runtime');
      console.error(
        '\n╔════════════════════════════════════════════════════════════════╗',
      );
      console.error(
        '║  FATAL: Container runtime failed to start                      ║',
      );
      console.error(
        '║                                                                ║',
      );
      console.error(
        '║  Agents cannot run without a container runtime. To fix:        ║',
      );
      console.error(
        '║  1. Ensure Apple Container is installed                        ║',
      );
      console.error(
        '║  2. Run: container system start                                ║',
      );
      console.error(
        '║  3. Restart NanoClaw                                           ║',
      );
      console.error(
        '╚════════════════════════════════════════════════════════════════╝\n',
      );
      throw new Error('Container runtime is required but failed to start');
    }
  }
}

/** Kill orphaned NanoClaw containers from previous runs. */
export function cleanupOrphans(): void {
  try {
    const output = execSync(`${CONTAINER_RUNTIME_BIN} ls --format json`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const containers: { status: string; configuration: { id: string } }[] =
      JSON.parse(output || '[]');
    const orphans = containers
      .filter(
        (c) =>
          c.status === 'running' && c.configuration.id.startsWith('nanoclaw-'),
      )
      .map((c) => c.configuration.id);
    for (const name of orphans) {
      try {
        stopContainer(name);
      } catch {
        /* already stopped */
      }
    }
    if (orphans.length > 0) {
      logger.info(
        { count: orphans.length, names: orphans },
        'Stopped orphaned containers',
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}
