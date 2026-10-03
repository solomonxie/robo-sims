const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);
const three = path.join(__dirname, 'node_modules/three');

// One Three.js instance, the WebGPU build: 'three' and 'three/webgpu' both resolve to it.
const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'three' || moduleName === 'three/webgpu') {
        return { filePath: path.join(three, 'build/three.webgpu.js'), type: 'sourceFile' };
      }
      if (moduleName.startsWith('three/addons/')) {
        return {
          filePath: path.join(three, 'examples/jsm', moduleName.slice('three/addons/'.length)),
          type: 'sourceFile',
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(defaultConfig, config);
