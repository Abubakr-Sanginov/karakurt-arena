import { createCampaignGame, advanceCampaign } from './simulation.js';
/** Reuse real map transitions for chapter selection rather than inventing partial simulation states. */
export function campaignAt(chapter = 1, completed = false) {
  const state = createCampaignGame({ seed: 1 });
  const index = Math.max(0, Math.min(2, chapter - 1));
  for (let i = 0; i < index; i++) { state.campaign.stage = 'outro'; advanceCampaign(state); }
  if (completed) { state.campaign.stage = 'outro'; advanceCampaign(state); }
  return state;
}
