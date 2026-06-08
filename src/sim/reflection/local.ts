import type { ReflectionPort, ReflectionInput } from '../ports.js';
import { needsUrgency } from '../needs.js';
import { CONFIG } from '../config.js';

export class LocalReflection implements ReflectionPort {
  readonly throttleMs = CONFIG.reflectionDefaultThrottleMs;

  reflect(input: ReflectionInput): Promise<{ goal: string } | null> {
    const urgentNeed = needsUrgency(input.needs);
    let goal: string;

    if (input.balance < 500) {
      goal = 'prioritise earning: head to work';
    } else if (urgentNeed === 'hunger' && input.needs.hunger < 30) {
      goal = 'satisfy hunger: buy food at market';
    } else if (urgentNeed === 'energy' && input.needs.energy < 30) {
      goal = 'rest and recover energy';
    } else if (urgentNeed === 'social' && input.needs.social < 30) {
      goal = 'seek social interaction at park';
    } else {
      goal = `maintain wellbeing: ${urgentNeed} priority`;
    }

    return Promise.resolve({ goal });
  }
}
