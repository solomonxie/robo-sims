module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // three.js uses static class blocks; Hermes needs them transpiled.
  plugins: ['@babel/plugin-transform-class-static-block'],
};
