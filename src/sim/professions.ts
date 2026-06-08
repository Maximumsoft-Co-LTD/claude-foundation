import type { LandmarkType } from './landmarks.js';

export interface Profession {
  id: string;
  name: string;
  jobLandmarkType: LandmarkType;
  wagePerShift: number;
}

export const PROFESSIONS: Record<string, Profession> = {
  market_vendor: {
    id: 'market_vendor',
    name: 'Market Vendor',
    jobLandmarkType: 'market',
    wagePerShift: 250,
  },
  office_worker: {
    id: 'office_worker',
    name: 'Office Worker',
    jobLandmarkType: 'office',
    wagePerShift: 350,
  },
  temple_volunteer: {
    id: 'temple_volunteer',
    name: 'Temple Volunteer',
    jobLandmarkType: 'temple',
    wagePerShift: 150,
  },
};

export const PROFESSION_IDS = Object.keys(PROFESSIONS) as string[];
