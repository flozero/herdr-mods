export const agentArgv = (config) => (Array.isArray(config?.agent) && config.agent.length ? config.agent.map(String) : ["claude"]);

const bin = (config) => agentArgv(config)[0].split("/").pop();

export function agentName(config) {
  if (config?.agentName) return String(config.agentName);
  return bin(config).charAt(0).toUpperCase() + bin(config).slice(1);
}

export function askArgv(config, deny) {
  if (Array.isArray(config?.agentAskArgs)) return [...agentArgv(config), ...config.agentAskArgs.map(String)];
  if (bin(config) !== "claude") return agentArgv(config);
  return [...agentArgv(config), "--permission-mode", "plan", "--settings", JSON.stringify({ permissions: { deny } })];
}
