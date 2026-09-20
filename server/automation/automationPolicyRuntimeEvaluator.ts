import type { AutomationEvaluationInput } from './types.js';
import { automationPersistence } from './automationPersistence.js';
import { automationPolicyEvaluator } from './automationPolicyEvaluator.js';

export class AutomationPolicyRuntimeEvaluator {
  public riskFor = automationPolicyEvaluator.riskFor.bind(
    automationPolicyEvaluator
  );

  public async evaluate(input: AutomationEvaluationInput) {
    if (!automationPersistence.usesPostgres()) {
      return automationPolicyEvaluator.evaluate(input);
    }

    const [policy, control] = await Promise.all([
      automationPersistence.getPolicy(input.accountId),
      automationPersistence.getControl(input.accountId),
    ]);

    return automationPolicyEvaluator.evaluateWithState(
      input,
      policy,
      control
    );
  }
}

export const automationPolicyRuntimeEvaluator =
  new AutomationPolicyRuntimeEvaluator();
