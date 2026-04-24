export type HubDeploySuccess = {
  success: true;
  pages: number;
  articles: number;
  uploaded: number;
  durationMs: number;
};

export type HubDeployFailureStage = 'auth' | 'query' | 'generate' | 'ftp' | 'unknown';

export type HubDeployFailure = {
  success: false;
  error: string;
  stage: HubDeployFailureStage;
  detail?: string;
  durationMs: number;
};

/** See docs/specs/hub-rebuild-guarantee.md §4.3 for the contract. */
export type HubDeployResponse = HubDeploySuccess | HubDeployFailure;
