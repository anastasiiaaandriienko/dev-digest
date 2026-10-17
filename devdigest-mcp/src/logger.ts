/**
 * stderr-only logger. stdout belongs to the MCP JSON-RPC stream over stdio:
 * anything else written there corrupts the protocol.
 */
export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

export const stderrLogger: Logger = {
  info: (message) => process.stderr.write(`[devdigest-mcp] ${message}\n`),
  error: (message) => process.stderr.write(`[devdigest-mcp] ERROR ${message}\n`),
};

export const silentLogger: Logger = { info: () => {}, error: () => {} };
