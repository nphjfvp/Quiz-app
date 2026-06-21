// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Firebase JS SDK v10 ist mit den neuen "package exports" von Metro
// (Standard ab Expo SDK 53 / RN 0.79+) nicht kompatibel: Metro laedt dann
// den falschen Auth-Build, wodurch "Component auth has not been registered yet"
// auftritt. Deaktivieren behebt das.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
