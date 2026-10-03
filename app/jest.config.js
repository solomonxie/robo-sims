module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  moduleNameMapper: { '^three/webgpu$': '<rootDir>/node_modules/three/build/three.webgpu.js' },
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native|@react-native(-community)?|three)/)'],
}
