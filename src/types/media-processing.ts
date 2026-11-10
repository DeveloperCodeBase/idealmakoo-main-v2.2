export const videoProfiles = ['web_480p', 'web_720p'] as const;
export type VideoProfile = typeof videoProfiles[number];
