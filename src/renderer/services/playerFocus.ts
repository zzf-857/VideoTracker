export const SUPPRESS_NEXT_PLAYER_BLUR_PAUSE_EVENT = 'videotracker:suppress-next-player-blur-pause';

export interface WindowBlurPauseDecision {
  pauseOnBlur: boolean;
  isPlaying: boolean;
  suppressNextBlurPause: boolean;
  activeElementId?: string;
}

export function shouldPausePlaybackOnWindowBlur(decision: WindowBlurPauseDecision): boolean {
  if (!decision.pauseOnBlur || !decision.isPlaying) return false;
  if (decision.suppressNextBlurPause) return false;
  if (decision.activeElementId === 'sidebar-search-input') return false;

  return true;
}
