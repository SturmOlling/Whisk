/**
 * What the operating system knows Whisk by. Whisk runs beside T3 Code, so none of
 * these may match upstream: sharing one would share data, links, or windows.
 */
export const APP_NAME = "Whisk";
export const APP_ID = "io.github.sturmolling.whisk";
export const APP_SCHEME = "whisk";
export const APP_DEVELOPMENT_SCHEME = "whisk-dev";
/** In the home directory. `.whisk` already names the folder inside writing projects. */
export const APP_HOME_DIRECTORY = ".whisk-app";
/** Not "whisk": on case-insensitive disks that is the local launcher's toolchain folder. */
export const APP_USER_DATA_DIRECTORY = "whisk-desktop";
export const APP_REPOSITORY_URL = "https://github.com/SturmOlling/Whisk";
