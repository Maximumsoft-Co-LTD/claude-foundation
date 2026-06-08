export const CONFIG: {
  tickIntervalMs: number;
  ticksPerDay: number;
  gridWidth: number;
  gridHeight: number;
  tileSize: number;
  needsDecayPerTick: { hunger: number; energy: number; social: number; money: number };
  needsMax: number;
  needsMin: number;
  actionThreshold: number;
  startingBalance: number;
  foodCost: number;
  foodSatisfaction: number;
  workWageBase: number;
  memoryCapPerContext: number;
  memoryLearningRate: number;
  relationshipCoPresenceTicks: number;
  relationshipMaxPerAgent: number;
  relationshipDecayThreshold: number;
  socialBonusFactor: number;
  relationshipStrengthGain: number;
  relationshipDecayPerTick: number;
  reflectionDefaultThrottleMs: number;
  sleepNeedThreshold: number;
  sleepSatisfaction: number;
  restSatisfaction: number;
  restEnergySatisfaction: number;
  agentCount: number;
} = {
  tickIntervalMs: 100,
  ticksPerDay: 240,
  gridWidth: 30,
  gridHeight: 30,
  tileSize: 32,

  needsDecayPerTick: {
    hunger: 0.15,
    energy: 0.10,
    social: 0.05,
    money: 0,
  },

  needsMax: 100,
  needsMin: 0,
  actionThreshold: 0,

  startingBalance: 5000,
  foodCost: 200,
  foodSatisfaction: 40,
  workWageBase: 300,

  memoryCapPerContext: 20,
  memoryLearningRate: 0.1,

  relationshipCoPresenceTicks: 5,
  relationshipMaxPerAgent: 10,
  relationshipDecayThreshold: 0.1,
  socialBonusFactor: 0.5,
  relationshipStrengthGain: 0.1,
  relationshipDecayPerTick: 0.001,

  reflectionDefaultThrottleMs: 60_000,

  sleepNeedThreshold: 30,
  sleepSatisfaction: 50,
  restSatisfaction: 20,
  restEnergySatisfaction: 25,

  agentCount: 50,
};
