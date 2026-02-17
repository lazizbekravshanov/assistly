export class PolicyEngine {
  constructor({ blockedCommands = [], approvalRequiredCommands = [] } = {}) {
    this.blocked = new Set(blockedCommands);
    this.requiresApproval = new Set(approvalRequiredCommands);
  }

  canExecute(commandName) {
    if (this.blocked.has(commandName)) {
      return { allowed: false, reason: 'blocked_by_policy' };
    }
    return { allowed: true };
  }

  needsApproval(commandName, context = {}) {
    if (commandName === '/post' && context.platform === 'all') return true;
    if (this.requiresApproval.has(commandName)) return true;
    return false;
  }
}
