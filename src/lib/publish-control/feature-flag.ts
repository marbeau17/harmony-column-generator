export type PublishControlMode = 'off' | 'shadow' | 'on';

export function publishControlMode(): PublishControlMode {
  const raw = process.env.PUBLISH_CONTROL_V2?.toLowerCase();
  if (raw === 'on' || raw === 'shadow') return raw;
  return 'off';
}

export function isPublishControlEnabled(): boolean {
  return publishControlMode() === 'on';
}
