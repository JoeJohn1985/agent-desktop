'use strict';

const path = require('path');
const { bundledPaths } = require('./claude-runtime');

module.exports = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const resources = platform === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const arch = require('builder-util').Arch[context.arch];
  bundledPaths({ appPath: path.join(resources, 'app.asar'), platform, arch });
};
