/**
 * The version shown in the footer.
 *
 * This used to be typed straight into the JSX, where it drifted: the footer read
 * v1.0.0 while package.json still said 0.1.0. Both now come from here, and a
 * unit test fails if they fall out of step again.
 *
 * Semver, judged from a user's view of the site: patch for fixes, minor for new
 * capability, major for a change that breaks how the app or its API is used.
 */
export const APP_VERSION = "1.0.1";
