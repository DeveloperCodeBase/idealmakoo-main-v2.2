import packageManifest from '../../package.json';

/** Source package version and deployment identity have distinct meanings. */
export const applicationVersion = packageManifest.version;
export const releaseVersion = () => process.env.RELEASE_SHA || applicationVersion;
